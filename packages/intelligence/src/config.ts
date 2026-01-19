type OpConfig = { temperature?: number };

export const MODEL_CONFIG = {
  classification: {
    model: "gpt-5-nano-2025-08-07",
    isQuestion: {} as OpConfig,
    shouldEscalate: { temperature: 0.1 } as OpConfig,
    isProductRequest: { temperature: 0.1 } as OpConfig,
  },
  extraction: {
    model: "gpt-5-nano-2025-08-07",
    bundleIntent: {} as OpConfig,
  },
  generation: {
    model: "gpt-5-nano-2025-08-07",
    answerQuestion: { temperature: 0.7 } as OpConfig,
    suggestAlternative: { temperature: 0.8 } as OpConfig,
    recoverUnclear: {} as OpConfig,
    handleBacklog: { temperature: 0.8 } as OpConfig,
  },
  vision: {
    model: "gemini-2.5-flash-lite",
    extractProductData: { temperature: 0.1 } as OpConfig,
  },
} as const;
