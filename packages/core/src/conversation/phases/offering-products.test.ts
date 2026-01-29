import { describe, test, expect } from "bun:test";
import { transitionOfferingProducts } from "./offering-products.ts";
import type { ConversationMetadata } from "../types.ts";
import type { CatalogSnapshot } from "@totem/types";

describe("Offering Products Phase - Context Projection", () => {
  const mockPhase: any = {
    phase: "offering_products",
    lastShownCategory: "celulares",
    sentProducts: [],
  };

  const mockMetadata: ConversationMetadata = {
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  test("should send images when brand IS in context", () => {
    const context: CatalogSnapshot = {
      activeBrands: ["Samsung", "Apple"],
      activeCategories: ["celulares"],
    };

    const result = transitionOfferingProducts(
      mockPhase,
      "Quiero un Samsung",
      mockMetadata,
      undefined,
      undefined,
      context,
    );

    expect(result.type).toBe("update");
    if (result.type === "update") {
      const sendImages = result.commands.find((c) => c.type === "SEND_IMAGES");
      expect(sendImages).toBeDefined();
      expect((sendImages as any).query).toBe("samsung");
    }
  });

  test("should BLOCK images when brand is NOT in context", () => {
    const context: CatalogSnapshot = {
      activeBrands: ["Samsung", "Apple"],
      activeCategories: ["celulares"],
    };

    const result = transitionOfferingProducts(
      mockPhase,
      "Quiero un Tecno",
      mockMetadata,
      undefined,
      undefined,
      context,
    );

    if (result.type === "update") {
      const sendImages = result.commands.find((c) => c.type === "SEND_IMAGES");
      if (sendImages) {
        expect((sendImages as any).query).not.toContain("tecno");
      }
    } else {
      expect(result.type).toBe("need_enrichment");
    }
  });
});
