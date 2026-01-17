import type { IntelligenceProvider } from "../provider";

export function createMockProvider(): IntelligenceProvider & {
  setResponse(operation: string, response: unknown): void;
  reset(): void;
} {
  const responses = new Map<string, unknown>();

  return {
    isQuestion: async () => (responses.get("isQuestion") as boolean) ?? false,

    shouldEscalate: async () =>
      (responses.get("shouldEscalate") as boolean) ?? false,

    isProductRequest: async () =>
      (responses.get("isProductRequest") as boolean) ?? false,

    extractBundleIntent: async () =>
      (responses.get("extractBundleIntent") as any) ?? {
        bundle: null,
        confidence: 0,
      },

    answerQuestion: async () =>
      (responses.get("answerQuestion") as string) ?? "Déjame ayudarte con eso.",

    suggestAlternative: async (requested, available) =>
      (responses.get("suggestAlternative") as string) ??
      `No tenemos ${requested}. ¿Te interesa ${available[0] || "algo más"}?`,

    recoverUnclearResponse: async () =>
      (responses.get("recoverUnclearResponse") as string) ??
      "Disculpa, no te entendí. ¿Puedes repetirlo?",

    handleBacklogResponse: async () =>
      (responses.get("handleBacklogResponse") as string) ??
      "Disculpa la demora, recién vi tu mensaje.",

    extractProductData: async () =>
      (responses.get("extractProductData") as any) ?? {
        name: null,
        price: null,
        installments: null,
        category: null,
        description: null,
      },

    setResponse(operation: string, response: unknown) {
      responses.set(operation, response);
    },

    reset() {
      responses.clear();
    },
  };
}
