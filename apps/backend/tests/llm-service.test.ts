import { describe, test, expect, beforeAll, setDefaultTimeout } from "bun:test";
import * as LLM from "../src/services/llm.ts";

setDefaultTimeout(30000);

const FORCE_SKIP = process.env.SKIP_LLM_TESTS === "1";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("LLM Service - Question Detection", () => {
  beforeAll(() => {
    if (!process.env.GEMINI_API_KEY && !FORCE_SKIP) {
      console.warn("GEMINI_API_KEY not set");
    } else if (process.env.GEMINI_API_KEY) {
      console.log("GEMINI_API_KEY found");
    }
  });

  test.skipIf(FORCE_SKIP)("detects question with ?", async () => {
    const result = await LLM.isQuestion("¿Cuánto cuesta?");
    expect(result).toBe(true);
    await delay(1000);
  });

  test.skipIf(FORCE_SKIP)(
    "does not detect affirmation as question",
    async () => {
      const result = await LLM.isQuestion("Sí, me interesa");
      expect(result).toBe(false);
      await delay(1000);
    },
  );

  test.skipIf(FORCE_SKIP)("does not detect negation as question", async () => {
    const result = await LLM.isQuestion("No gracias");
    expect(result).toBe(false);
    await delay(1000);
  });
});

describe("LLM Service - Category Extraction", () => {
  const categories = [
    "celulares",
    "cocinas",
    "laptops",
    "refrigeradoras",
    "televisores",
    "termas",
  ];

  test.skipIf(FORCE_SKIP)("extracts brand to category", async () => {
    const result = await LLM.extractEntity(
      "Quiero un iPhone",
      "product_category",
      {
        availableCategories: categories,
      },
    );
    expect(result).not.toBeNull();
    expect(result?.toLowerCase()).toMatch(/celular/);
    await delay(1000);
  });

  test.skipIf(FORCE_SKIP)("returns null for no category", async () => {
    const result = await LLM.extractEntity(
      "Hola, buenos días",
      "product_category",
      {
        availableCategories: categories,
      },
    );
    expect(result).toBeNull();
    await delay(1000);
  });
});

describe("LLM Service - Question Answering", () => {
  test.skipIf(FORCE_SKIP)("returns valid response structure", async () => {
    const result = await LLM.answerQuestion("¿Cómo funciona?", {
      segment: "fnb",
      creditLine: 3000,
    });
    expect(result).toHaveProperty("answer");
    expect(result).toHaveProperty("requiresHuman");
    expect(typeof result.answer).toBe("string");
    expect(typeof result.requiresHuman).toBe("boolean");
    await delay(1000);
  });

  test.skipIf(FORCE_SKIP)("escalates on exact amount question", async () => {
    const result = await LLM.answerQuestion(
      "¿Cuánto exactamente en soles pago por cuota?",
      {
        segment: "gaso",
        creditLine: 2500,
      },
    );
    expect(result.requiresHuman).toBe(true);
    await delay(1000);
  });

  test.skipIf(FORCE_SKIP)("escalates on complaint", async () => {
    const result = await LLM.answerQuestion("Quiero hacer un reclamo formal", {
      segment: "fnb",
      creditLine: 3000,
    });
    expect(result.requiresHuman).toBe(true);
    await delay(1000);
  });
});

describe("LLM Service - Error Handling", () => {
  test("returns false on isQuestion failure", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await LLM.isQuestion("test");
    expect(result).toBe(false);
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  });

  test("returns null on extractEntity failure", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await LLM.extractEntity("test", "product_category");
    expect(result).toBeNull();
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  });

  test("returns fallback on answerQuestion failure", async () => {
    const originalKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const result = await LLM.answerQuestion("test", { segment: "fnb" });
    expect(result.requiresHuman).toBe(true);
    expect(result.answer.length).toBeGreaterThan(0);
    if (originalKey) process.env.GEMINI_API_KEY = originalKey;
  });
});
