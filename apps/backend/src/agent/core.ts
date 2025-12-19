import type { Conversation, ConversationState, Segment } from "@totem/types";
import { CatalogService } from "../services/catalog";
import { FNBProvider, GasoProvider } from "../services/providers";
import { classifyIntent, extractEntity } from "../services/llm";

type AgentResult = {
    nextState: ConversationState;
    updatedContext: Partial<Conversation>;
    messages: string[];
    actions?: Array<{ type: "SEND_IMAGE"; path: string }>;
};

export async function runAgent(
    state: ConversationState,
    message: string,
    context: Conversation,
): Promise<AgentResult> {
    const contextData = JSON.parse(context.context_data || "{}");

    if (state === "INIT") {
        return {
            nextState: "CONFIRM_CLIENT",
            updatedContext: {},
            messages: [
                "¡Hola! Somos aliados de Calidda. ¿Eres cliente de Calidda?",
            ],
        };
    }

    if (state === "CONFIRM_CLIENT") {
        const intent = await classifyIntent(message);
        if (intent === "yes") {
            return {
                nextState: "COLLECT_DNI",
                updatedContext: { is_calidda_client: 1 },
                messages: [
                    "Genial. Por favor, indícame tu número de DNI para verificar tus beneficios.",
                ],
            };
        } else if (intent === "no") {
            return {
                nextState: "CLOSING",
                updatedContext: { is_calidda_client: 0 },
                messages: [
                    "Entiendo. Por el momento solo atendemos a clientes Calidda. ¡Gracias!",
                ],
            };
        }
        return {
            nextState: "CONFIRM_CLIENT",
            updatedContext: {},
            messages: [
                "Disculpa, no entendí. ¿Eres cliente de Calidda? (Sí/No)",
            ],
        };
    }

    if (state === "COLLECT_DNI") {
        const dni = message.replace(/\D/g, "");
        if (dni.length !== 8)
            return {
                nextState: "COLLECT_DNI",
                updatedContext: {},
                messages: ["El DNI debe tener 8 dígitos."],
            };

        const fnb = await FNBProvider.checkCredit(dni);
        if (fnb.eligible) {
            return {
                nextState: "OFFER_PRODUCTS",
                updatedContext: {
                    dni,
                    segment: "fnb",
                    client_name: fnb.name,
                    credit_line: fnb.credit,
                },
                messages: [
                    `¡Hola ${fnb.name}! Tienes un crédito aprobado de S/ ${fnb.credit}. Tenemos celulares, laptops y más. ¿Qué buscas?`,
                ],
            };
        }

        const gaso = await GasoProvider.checkEligibility(dni);
        if (gaso.eligible) {
            return {
                nextState: "COLLECT_AGE",
                updatedContext: {
                    dni,
                    segment: "gaso",
                    client_name: gaso.name,
                    credit_line: gaso.credit,
                    nse: gaso.nse,
                },
                messages: [
                    `Hola ${gaso.name}, para continuar, ¿cuántos años tienes?`,
                ],
            };
        }

        return {
            nextState: "CLOSING",
            updatedContext: { dni },
            messages: ["Lo sentimos, no calificas en este momento."],
        };
    }

    if (state === "COLLECT_AGE") {
        const ageStr = await extractEntity(message, "age");
        const age = parseInt(ageStr || "0");
        const minAge = context.nse && context.nse <= 2 ? 40 : 30;

        if (age < minAge)
            return {
                nextState: "CLOSING",
                updatedContext: {},
                messages: [`Debes tener al menos ${minAge} años.`],
            };

        const products = CatalogService.getBySegment("gaso");
        const hasKitchen = products.some((p) =>
            p.category.toLowerCase().includes("cocina"),
        );

        if (!hasKitchen)
            return {
                nextState: "ESCALATED",
                updatedContext: {},
                messages: ["Un asesor te contactará."],
            };

        return {
            nextState: "OFFER_PRODUCTS",
            updatedContext: {},
            messages: [
                "¡Calificas! Tenemos combos de Cocina + Gasodoméstico. ¿Te gustaría verlos?",
            ],
        };
    }

    if (state === "OFFER_PRODUCTS") {
        const intent = await classifyIntent(message);
        if (intent === "no")
            return {
                nextState: "HANDLE_OBJECTION",
                updatedContext: {},
                messages: ["¿Buscabas otro producto?"],
            };

        let category = await extractEntity(message, "category");
        if (!category && context.segment === "gaso") category = "cocinas";

        if (category) {
            const products = CatalogService.getBySegment(
                context.segment as Segment,
            )
                .filter((p) =>
                    p.category.toLowerCase().includes(category!.toLowerCase()),
                )
                .slice(0, 3);

            if (products.length === 0)
                return {
                    nextState: "OFFER_PRODUCTS",
                    updatedContext: {},
                    messages: ["No tenemos stock en esa categoría."],
                };

            return {
                nextState: "CLOSING",
                updatedContext: {
                    context_data: JSON.stringify({
                        ...contextData,
                        offered: true,
                    }),
                },
                messages: ["Aquí tienes nuestras opciones:"],
                actions: products.map((p) => ({
                    type: "SEND_IMAGE",
                    path: p.image_main_path,
                })),
            };
        }
        return {
            nextState: "OFFER_PRODUCTS",
            updatedContext: {},
            messages: ["¿Qué producto buscas? (Ej: Celular, TV)"],
        };
    }

    if (state === "CLOSING" || state === "HANDLE_OBJECTION") {
        return {
            nextState: "ESCALATED",
            updatedContext: {},
            messages: ["Un asesor humano finalizará tu pedido."],
        };
    }

    return {
        nextState: state,
        updatedContext: {},
        messages: ["No entendí, ¿puedes repetir?"],
    };
}
