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

    answerQuestion: async () =>
      (responses.get("answerQuestion") as string) ?? "Déjame ayudarte con eso.",

    recoverUnclearResponse: async () =>
      (responses.get("recoverUnclearResponse") as string) ??
      "Disculpa, no te entendí. ¿Puedes repetirlo?",

    setResponse(operation: string, response: unknown) {
      responses.set(operation, response);
    },

    reset() {
      responses.clear();
    },
  };
}
