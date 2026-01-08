import { describe, test, expect } from "bun:test";
import { transition } from "../src/state-machine/router";
import type { StateContext, Command } from "../src/state-machine/types";

describe("Improved Intent Recognition in OFFER_PRODUCTS", () => {
  const context: StateContext = {
    phoneNumber: "51987654321",
    segment: "fnb",
    creditLine: 5000,
    offeredCategory: "celulares",
  };

  test("Should recognize 'me interesa' as purchase intent", () => {
    const result = transition({
      currentState: "OFFER_PRODUCTS",
      message: "me interesa",
      context,
    });

    expect(result.nextState).toBe("CLOSING");
    expect(result.updatedContext.purchaseConfirmed).toBe(true);
  });

  test("Should recognize ordinal 'el primero' as purchase intent", () => {
    const result = transition({
      currentState: "OFFER_PRODUCTS",
      message: "me interesa el primero",
      context,
    });

    expect(result.nextState).toBe("CLOSING");
    expect(result.updatedContext.purchaseConfirmed).toBe(true);
  });

  test("Should recognize 'me lo llevo' (existing phrase)", () => {
    const result = transition({
      currentState: "OFFER_PRODUCTS",
      message: "me lo llevo",
      context,
    });

    expect(result.nextState).toBe("CLOSING");
    expect(result.updatedContext.purchaseConfirmed).toBe(true);
  });

  test("Should provide contextual fallback for uncertain users when products offered", () => {
    const result = transition({
      currentState: "OFFER_PRODUCTS",
      message: "no sé...",
      context,
    });

    expect(result.nextState).toBe("OFFER_PRODUCTS");
    const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
    expect(msg?.content).toContain("alguno de los que te mostré");
  });

  test("Should provide generic fallback for uncertain users when NO products offered", () => {
    const result = transition({
      currentState: "OFFER_PRODUCTS",
      message: "no sé...",
      context: { ...context, offeredCategory: undefined },
    });

    expect(result.nextState).toBe("OFFER_PRODUCTS");
    const msg = result.commands.find((c) => c.type === "SEND_MESSAGE");
    expect(msg?.content).toMatch(/[Cc]elulares/); // Case-insensitive check for celulares
  });

  describe("Returning User Flow", () => {
    const returningContext: StateContext = {
      phoneNumber: "51987654321",
      lastInterestCategory: "celulares",
      dni: "72345678",
      clientName: "YASMIN",
      segment: "fnb" as any,
      creditLine: 8000,
      isCaliddaClient: true,
    };

    test("Should skip DNI and jump to products if returning with data", () => {
      const result = transition({
        currentState: "CONFIRM_CLIENT",
        message: "si",
        context: returningContext,
      });

      expect(result.nextState).toBe("OFFER_PRODUCTS");
      expect(
        result.commands.some(
          (c) => c.type === "SEND_MESSAGE" && c.content.includes("Yasmin"),
        ),
      ).toBe(true);
      expect(
        result.commands.some(
          (c) => c.type === "SEND_MESSAGE" && c.content.includes("celulares"),
        ),
      ).toBe(true);
    });

    test("Should skip DNI and go to COLLECT_AGE if returning Gaso user without age", () => {
      const gasoReturningContext = {
        ...returningContext,
        segment: "gaso" as any,
        creditLine: 3000,
      };
      const result = transition({
        currentState: "CONFIRM_CLIENT",
        message: "si",
        context: gasoReturningContext,
      });

      expect(result.nextState).toBe("COLLECT_AGE");
    });
  });
});
