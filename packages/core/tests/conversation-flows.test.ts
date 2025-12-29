import { describe, test, expect } from "bun:test";
import { transition } from "../src/state-machine/transitions";
import type { StateContext, Command } from "../src/state-machine/types";

describe("End-to-End Conversation Flows", () => {
    describe("Happy path: FNB client purchases successfully", () => {
        let context: StateContext = { phoneNumber: "51987654321" };

        test("1. Bot greets user", () => {
            const result = transition({
                currentState: "INIT",
                message: "",
                context,
            });

            expect(result.nextState).toBe("CONFIRM_CLIENT");
            context = { ...context, ...result.updatedContext };
        });

        test("2. User confirms they are Calidda client", () => {
            const result = transition({
                currentState: "CONFIRM_CLIENT",
                message: "Sí",
                context,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            expect(result.updatedContext.isCaliddaClient).toBe(true);
            context = { ...context, ...result.updatedContext };
        });

        test("3. User provides DNI", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "72345678",
                context,
            });

            expect(result.nextState).toBe("WAITING_PROVIDER");
            expect(result.updatedContext.dni).toBe("72345678");
            expect(result.commands).toContainEqual({
                type: "CHECK_FNB",
                dni: "72345678",
            });
            context = { ...context, ...result.updatedContext };
        });

        test("4. Provider returns positive result (simulated by adding context)", () => {
            // Backend would add this after provider check
            context = {
                ...context,
                segment: "fnb",
                creditLine: 5000,
                clientName: "Juan Pérez",
            };

            const result = transition({
                currentState: "COLLECT_AGE",
                message: "35",
                context,
            });

            expect(result.nextState).toBe("OFFER_PRODUCTS");
            expect(result.updatedContext.age).toBe(35);
            context = { ...context, ...result.updatedContext };
        });

        test("5. User asks for celulares", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Me interesan los celulares",
                context,
            });

            expect(result.nextState).toBe("OFFER_PRODUCTS");
            expect(result.updatedContext.offeredCategory).toBe("celulares");
            expect(result.commands).toContainEqual({
                type: "SEND_IMAGES",
                productIds: [],
                category: "celulares",
            });
            context = { ...context, ...result.updatedContext };
        });

        test("6. User confirms purchase", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Sí, me lo llevo",
                context,
            });

            expect(result.nextState).toBe("CLOSING");
            expect(result.updatedContext.purchaseConfirmed).toBe(true);
            expect(result.commands).toContainEqual({
                type: "NOTIFY_TEAM",
                channel: "sales",
                message: expect.stringContaining("confirmó interés"),
            });
        });
    });

    describe("Edge case: User hesitates with DNI, then provides it", () => {
        let context: StateContext = {
            phoneNumber: "51987654321",
            isCaliddaClient: true,
        };

        test("1. User says they don't have DNI at hand", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "no lo tengo a la mano",
                context,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            expect(result.commands).toHaveLength(1);
            expect(result.updatedContext.askedToWait).toBe(true);
            context = { ...context, ...result.updatedContext };
        });

        test("2. User says they'll look for it", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "déjame buscarlo",
                context,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            expect(result.commands).toHaveLength(0); // Silent
            context = { ...context, ...result.updatedContext };
        });

        test("3. User sends acknowledgment while searching", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "ya",
                context,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            expect(result.commands).toHaveLength(0); // Silent
        });

        test("4. User finally provides DNI", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "72345678",
                context,
            });

            expect(result.nextState).toBe("WAITING_PROVIDER");
            expect(result.updatedContext.dni).toBe("72345678");
        });
    });

    describe("Edge case: User gets impatient during provider check", () => {
        let context: StateContext = {
            phoneNumber: "51987654321",
            dni: "72345678",
        };

        test("1. User sends first impatient message", () => {
            const result = transition({
                currentState: "WAITING_PROVIDER",
                message: "¿Ya?",
                context,
            });

            expect(result.nextState).toBe("WAITING_PROVIDER");
            expect(result.updatedContext.waitingMessageCount).toBe(1);
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            expect(msg).toBeDefined();
            context = { ...context, ...result.updatedContext };
        });

        test("2. User sends second impatient message", () => {
            const result = transition({
                currentState: "WAITING_PROVIDER",
                message: "Cuánto demora?",
                context,
            });

            expect(result.nextState).toBe("WAITING_PROVIDER");
            expect(result.updatedContext.waitingMessageCount).toBe(2);
            context = { ...context, ...result.updatedContext };
        });

        test("3. User sends third message - bot escalates", () => {
            const result = transition({
                currentState: "WAITING_PROVIDER",
                message: "Ya pasó mucho tiempo",
                context,
            });

            expect(result.nextState).toBe("ESCALATED");
            expect(result.commands).toContainEqual({
                type: "ESCALATE",
                reason: "provider_check_timeout_multiple_messages",
            });
        });
    });

    describe("GASO flow: Age restriction failure", () => {
        let context: StateContext = {
            phoneNumber: "51987654321",
            segment: "gaso",
            nse: 2,
            creditLine: 5000,
        };

        test("1. User provides age below threshold (39, needs 40)", () => {
            const result = transition({
                currentState: "COLLECT_AGE",
                message: "39",
                context,
            });

            expect(result.nextState).toBe("CLOSING");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            expect(msg?.type).toBe("SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                expect(msg.content).toContain("40 años");
            }
        });
    });

    describe("GASO flow: Kitchen bundle objection handling", () => {
        let context: StateContext = {
            phoneNumber: "51987654321",
            segment: "gaso",
            creditLine: 3000,
            age: 45,
        };

        test("1. User rejects initial offer", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "no gracias",
                context,
            });

            expect(result.nextState).toBe("HANDLE_OBJECTION");
            expect(result.updatedContext.objectionCount).toBe(1);
            context = { ...context, ...result.updatedContext };
        });

        test("2. User rejects again", () => {
            const result = transition({
                currentState: "HANDLE_OBJECTION",
                message: "no quiero",
                context,
            });

            expect(result.nextState).toBe("HANDLE_OBJECTION");
            expect(result.updatedContext.objectionCount).toBe(2);
            context = { ...context, ...result.updatedContext };
        });

        test("3. User rejects third time - bot escalates", () => {
            const result = transition({
                currentState: "HANDLE_OBJECTION",
                message: "no me interesa",
                context,
            });

            expect(result.nextState).toBe("ESCALATED");
            expect(result.commands).toContainEqual({
                type: "ESCALATE",
                reason: "Multiple objections to mandatory kitchen bundle",
            });
            expect(result.commands).toContainEqual({
                type: "NOTIFY_TEAM",
                channel: "agent",
                message: expect.stringContaining("rechazó"),
            });
        });
    });

    describe("Price objection should NOT be treated as rejection", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            segment: "fnb",
            creditLine: 3000,
            offeredCategory: "celulares",
        };

        test("User asks about price with 'no' in message", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "no tengo mucha plata, cuánto cuesta?",
                context,
            });

            // Should NOT go to HANDLE_OBJECTION or CLOSING
            expect(result.nextState).toBe("OFFER_PRODUCTS");
            expect(result.updatedContext.purchaseConfirmed).toBeUndefined();

            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            expect(msg?.type).toBe("SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                // Should mention financing/payment options
                const mentionsFinancing = /financi|cuota|pag/i.test(msg.content);
                expect(mentionsFinancing).toBe(true);
            }
        });
    });

    describe("Purchase confirmation only after products shown", () => {
        test("Should NOT confirm purchase if no products offered", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Sí, lo quiero",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 3000,
                    // NO offeredCategory
                },
            });

            expect(result.nextState).toBe("OFFER_PRODUCTS");
            expect(result.updatedContext.purchaseConfirmed).toBeUndefined();
        });

        test("Should confirm purchase after products shown", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Sí, lo compro",
                context: {
                    phoneNumber: "51987654321",
                    segment: "fnb",
                    creditLine: 3000,
                    offeredCategory: "laptops", // Products shown
                },
            });

            expect(result.nextState).toBe("CLOSING");
            expect(result.updatedContext.purchaseConfirmed).toBe(true);
        });
    });

    describe("Not Calidda client flow", () => {
        test("User says no to being Calidda client", () => {
            const result = transition({
                currentState: "CONFIRM_CLIENT",
                message: "No",
                context: { phoneNumber: "51987654321" },
            });

            expect(result.nextState).toBe("CLOSING");
            expect(result.updatedContext.isCaliddaClient).toBe(false);

            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            expect(msg?.type).toBe("SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                expect(msg.content).toMatch(/clientes.*C[aá]lidda|servicio.*C[aá]lidda/i);
            }
        });
    });

    describe("Returning user flow", () => {
        test("Should greet with last interest category", () => {
            const result = transition({
                currentState: "INIT",
                message: "",
                context: {
                    phoneNumber: "51987654321",
                    lastInterestCategory: "refrigeradoras",
                },
            });

            expect(result.nextState).toBe("CONFIRM_CLIENT");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            expect(msg?.type).toBe("SEND_MESSAGE");
            if (msg?.type === "SEND_MESSAGE") {
                expect(msg.content).toContain("refrigeradoras");
            }
        });
    });

    describe("Invalid DNI formats", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            isCaliddaClient: true,
        };

        test("Should reject DNI with letters", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "ABC12345",
                context,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
            const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
            expect(msg?.type).toBe("SEND_MESSAGE");
        });

        test("Should reject DNI with only 7 digits", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "1234567",
                context,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
        });

        test("Should reject DNI with 9 digits", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "123456789",
                context,
            });

            expect(result.nextState).toBe("COLLECT_DNI");
        });

        test("Should extract DNI from text with 8 consecutive digits", () => {
            const result = transition({
                currentState: "COLLECT_DNI",
                message: "Mi documento es 72345678 gracias",
                context,
            });

            expect(result.nextState).toBe("WAITING_PROVIDER");
            expect(result.updatedContext.dni).toBe("72345678");
        });
    });

    describe("Brand name to category normalization", () => {
        const context: StateContext = {
            phoneNumber: "51987654321",
            segment: "fnb",
            creditLine: 3000,
            age: 30,
        };

        test("iPhone should map to celulares", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Quiero un iPhone",
                context,
            });

            expect(result.updatedContext.offeredCategory).toBe("celulares");
        });

        test("Samsung should map to celulares", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "Samsung Galaxy",
                context,
            });

            expect(result.updatedContext.offeredCategory).toBe("celulares");
        });

        test("Notebook should map to laptops", () => {
            const result = transition({
                currentState: "OFFER_PRODUCTS",
                message: "notebook",
                context,
            });

            expect(result.updatedContext.offeredCategory).toBe("laptops");
        });
    });
});

describe("Command generation validation", () => {
    test("CHECK_FNB should be generated with DNI", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "72345678",
            context: { phoneNumber: "51987654321" },
        });

        const checkCommand = result.commands.find(
            (c): c is Extract<Command, { type: "CHECK_FNB" }> =>
                c.type === "CHECK_FNB",
        );
        expect(checkCommand).toBeDefined();
        expect(checkCommand?.dni).toBe("72345678");
    });

    test("SEND_IMAGES should include category", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "cocina",
            context: {
                phoneNumber: "51987654321",
                segment: "fnb",
                creditLine: 3000,
            },
        });

        const imagesCommand = result.commands.find(
            (c): c is Extract<Command, { type: "SEND_IMAGES" }> =>
                c.type === "SEND_IMAGES",
        );
        expect(imagesCommand).toBeDefined();
        expect(imagesCommand?.category).toBe("cocinas");
    });

    test("NOTIFY_TEAM should be sent on purchase confirmation", () => {
        const result = transition({
            currentState: "OFFER_PRODUCTS",
            message: "Sí, lo compro",
            context: {
                phoneNumber: "51987654321",
                segment: "fnb",
                offeredCategory: "celulares",
            },
        });

        const notifyCommand = result.commands.find(
            (c): c is Extract<Command, { type: "NOTIFY_TEAM" }> =>
                c.type === "NOTIFY_TEAM",
        );
        expect(notifyCommand).toBeDefined();
        expect(notifyCommand?.channel).toBe("sales");
    });

    test("TRACK_EVENT should include metadata", () => {
        const result = transition({
            currentState: "COLLECT_DNI",
            message: "72345678",
            context: { phoneNumber: "51987654321" },
        });

        const trackCommand = result.commands.find(
            (c): c is Extract<Command, { type: "TRACK_EVENT" }> =>
                c.type === "TRACK_EVENT",
        );
        expect(trackCommand).toBeDefined();
        expect(trackCommand?.eventType).toBe("dni_collected");
        expect(trackCommand?.metadata).toHaveProperty("dni");
    });

    test("ESCALATE should include reason", () => {
        const result = transition({
            currentState: "WAITING_PROVIDER",
            message: "???",
            context: {
                phoneNumber: "51987654321",
                waitingMessageCount: 2,
            },
        });

        const escalateCommand = result.commands.find(
            (c): c is Extract<Command, { type: "ESCALATE" }> =>
                c.type === "ESCALATE",
        );
        expect(escalateCommand).toBeDefined();
        expect(escalateCommand?.reason).toContain("timeout");
    });
});
