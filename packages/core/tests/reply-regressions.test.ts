import { describe, expect, test } from "bun:test";
import { transition } from "../src/conversation";
import type { ConversationMetadata } from "../src/conversation/types";

const metadata = (): ConversationMetadata => ({
  createdAt: Date.now(),
  lastActivityAt: Date.now(),
});

describe("offering products: short replies", () => {
  const browsing = {
    phase: "offering_products" as const,
    segment: "fnb" as const,
    credit: 5000,
    name: "Juan",
    availableCategories: ["celulares", "tv", "refrigeradoras"],
    categoryDisplayNames: ["celulares", "televisores", "refrigeradoras"],
  };

  test.each(["no", "No.", "nada", "no gracias"])(
    "%p closes instead of picking a group",
    (message) => {
      const result = transition({
        phase: browsing,
        message,
        metadata: metadata(),
      });
      expect(result.type === "update" && result.nextPhase.phase).toBe(
        "closing",
      );
    },
  );

  test.each(["a", "te", "y"])("%p does not pick a group", (message) => {
    const result = transition({
      phase: browsing,
      message,
      metadata: metadata(),
    });
    const exploring =
      result.type === "update" &&
      result.nextPhase.phase === "offering_products" &&
      result.nextPhase.exploringGroup;
    expect(exploring).toBeFalsy();
  });

  test.each([
    ["tecnología", "celulares"],
    ["tecno", "celulares"],
    ["hogar", "refrigeradoras"],
    ["línea blanca", "refrigeradoras"],
  ])("%p still picks its group", (message, category) => {
    const result = transition({
      phase: browsing,
      message,
      metadata: metadata(),
    });
    if (result.type !== "update") throw new Error("expected an update");
    expect(result.nextPhase).toMatchObject({ exploringGroup: true });
    expect(result.commands).toContainEqual({
      type: "SEND_MESSAGE",
      text: expect.stringContaining(category),
    });
  });
});

describe("confirming a selection", () => {
  const confirming = {
    phase: "confirming_selection" as const,
    segment: "fnb" as const,
    credit: 5000,
    name: "Juan",
    selectedProduct: {
      name: "Samsung Galaxy A54",
      price: 1200,
      productId: "1",
    },
  };

  test.each(["bueno si", "bueno, sí", "ya dale"])(
    "%p confirms the purchase",
    (message) => {
      const result = transition({
        phase: confirming,
        message,
        metadata: metadata(),
      });
      expect(result.type === "update" && result.nextPhase).toEqual({
        phase: "closing",
        purchaseConfirmed: true,
      });
    },
  );

  test.each(["no", "quiero ver otros", "mejor no"])(
    "%p returns to browsing",
    (message) => {
      const result = transition({
        phase: confirming,
        message,
        metadata: metadata(),
      });
      expect(result.type === "update" && result.nextPhase.phase).toBe(
        "offering_products",
      );
    },
  );
});

describe("handling an objection", () => {
  const objection = {
    phase: "handling_objection" as const,
    segment: "fnb" as const,
    credit: 5000,
    name: "Juan",
    objectionCount: 1,
  };

  test("nada que ver, está caro is not acceptance", () => {
    const result = transition({
      phase: objection,
      message: "nada que ver, está caro",
      metadata: metadata(),
    });
    expect(result.type === "update" && result.nextPhase.phase).toBe(
      "handling_objection",
    );
  });

  test.each(["sí", "ok", "dale, muéstrame", "quiero ver"])(
    "%p accepts",
    (message) => {
      const result = transition({
        phase: objection,
        message,
        metadata: metadata(),
      });
      expect(result.type === "update" && result.nextPhase.phase).toBe(
        "offering_products",
      );
    },
  );
});
