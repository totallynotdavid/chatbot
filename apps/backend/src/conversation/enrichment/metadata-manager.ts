import type {
  EnrichmentRequest,
  EnrichmentResult,
  ConversationMetadata,
} from "@totem/core";
import { createLogger } from "../../lib/logger.ts";

const logger = createLogger("enrichment");

export function applyEnrichmentToMetadata(
  enrichment: EnrichmentResult,
  request: EnrichmentRequest,
  metadata: ConversationMetadata,
): void {
  switch (enrichment.type) {
    case "eligibility_result":
      applyEligibilityResult(enrichment, request, metadata);
      break;

    // Other enrichment types don't modify metadata
    // (they just return data for the state machine to use)
    default:
      break;
  }
}

/**
 * Responsibilities:
 * 1. Track DNI attempts (for duplicate detection and attempt counting)
 * 2. Persist customer data if eligible (dni, name, segment, credit, nse)
 */
function applyEligibilityResult(
  enrichment: Extract<EnrichmentResult, { type: "eligibility_result" }>,
  request: EnrichmentRequest,
  metadata: ConversationMetadata,
): void {
  if (request.type !== "check_eligibility") {
    return;
  }

  const dni = request.dni;
  const triedDnis = metadata.triedDnis || [];

  // Track DNI attempt if not already tracked
  if (!triedDnis.includes(dni)) {
    metadata.triedDnis = [...triedDnis, dni];
    logger.debug(
      { dni, attemptCount: metadata.triedDnis.length },
      "DNI attempt tracked",
    );
  }

  // Persist customer data if eligible
  if (enrichment.status === "eligible") {
    metadata.dni = dni;
    if (enrichment.name) metadata.name = enrichment.name;
    if (enrichment.segment) metadata.segment = enrichment.segment;
    if (enrichment.credit !== undefined) metadata.credit = enrichment.credit;
    if (enrichment.nse !== undefined) metadata.nse = enrichment.nse;

    logger.debug(
      { dni, name: enrichment.name, segment: enrichment.segment },
      "Customer data persisted to metadata",
    );
  }
}
