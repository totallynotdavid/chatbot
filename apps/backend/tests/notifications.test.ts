import { describe, it, expect } from "bun:test";
import { formatConversationDetails } from "../src/domains/conversations/notifications.ts";
import type { ConversationMetadata, ConversationPhase } from "@vendeya/core";

describe("formatConversationDetails", () => {
  const baseMetadata: ConversationMetadata = {
    name: "Juan Perez",
    dni: "12345678",
    segment: "fnb",
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };

  const phoneNumber = "51999999999";

  it("should format details correctly with full metadata", () => {
    const result = formatConversationDetails(baseMetadata, null, phoneNumber);
    expect(result).toContain("Nombre: Juan Perez");
    expect(result).toContain("DNI: 12345678");
    expect(result).toContain("Teléfono: 51999999999");
    expect(result).toContain("Producto: No disponible");
  });

  it("should fallback to phase data if metadata is missing", () => {
    const phase: ConversationPhase = {
      phase: "confirming_client",
      name: "Maria Lopez",
      dni: "87654321",
    } as any;

    const result = formatConversationDetails({}, phase, phoneNumber);
    expect(result).toContain("Nombre: Maria Lopez");
    expect(result).toContain("DNI: 87654321");
  });

  it("should handle missing name and DNI gracefully", () => {
    const result = formatConversationDetails({}, null, phoneNumber);
    expect(result).toContain("Nombre: No disponible");
    expect(result).toContain("DNI: No disponible");
  });

  it("should display selected product", () => {
    const phase: ConversationPhase = {
      phase: "offering_products",
      selectedProduct: { name: "iPhone 15", price: 3500 },
    } as any;

    const result = formatConversationDetails(baseMetadata, phase, phoneNumber);
    expect(result).toContain("Producto: iPhone 15 (S/ 3500.00)");
  });

  it("should display interested product if selected product is missing", () => {
    const phase: ConversationPhase = {
      phase: "offering_products",
      interestedProduct: { name: "Samsung S24", price: 3000 },
    } as any;

    const result = formatConversationDetails(baseMetadata, phase, phoneNumber);
    expect(result).toContain("Producto: Samsung S24 (S/ 3000.00)");
  });
});
