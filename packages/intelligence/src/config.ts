type OpConfig = { temperature?: number };

export const MODEL_CONFIG = {
  classification: {
    model: "gpt-5-nano-2025-08-07",
    isQuestion: {} as OpConfig,
    shouldEscalate: {} as OpConfig,
  },
  generation: {
    model: "gpt-5-nano-2025-08-07",
    answerQuestion: {} as OpConfig,
    suggestAlternative: {} as OpConfig,
    recoverUnclear: {} as OpConfig,
  },
  vision: {
    model: "gemini-2.5-flash-lite",
    extractProductData: { temperature: 0.1 } as OpConfig,
  },
} as const;
