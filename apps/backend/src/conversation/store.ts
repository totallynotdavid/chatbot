/**
 * Persistence layer for conversations-related data.
 * Stores ConversationPhase as discriminated union JSON.
 */

import { db } from "../db/index.ts";
import { getOne } from "../db/query.ts";
import type { Conversation } from "@totem/types";
import { conversation } from "@totem/core";

type ConversationPhase = conversation.ConversationPhase;
type ConversationMetadata = conversation.ConversationMetadata;
type ConversationData = {
  phoneNumber: string;
  phase: ConversationPhase;
  metadata: ConversationMetadata;
  isSimulation: boolean;
};

const DEFAULT_PHASE: ConversationPhase = { phase: "greeting" };

/**
 * Get or create a conversation
 */
export function getOrCreateConversation(
  phoneNumber: string,
  isSimulation = false,
): ConversationData {
  const conv = getOne<Conversation>(
    "SELECT * FROM conversations WHERE phone_number = ?",
    [phoneNumber],
  );

  if (!conv) {
    const now = Date.now();
    const initialPhase = DEFAULT_PHASE;
    const initialMetadata: ConversationMetadata = {
      createdAt: now,
      lastActivityAt: now,
    };

    db.prepare(
      `INSERT INTO conversations (phone_number, current_state, context_data, status, is_simulation)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      phoneNumber,
      JSON.stringify(initialPhase),
      JSON.stringify(initialMetadata),
      "active",
      isSimulation ? 1 : 0,
    );

    return {
      phoneNumber,
      phase: initialPhase,
      metadata: initialMetadata,
      isSimulation,
    };
  }

  return parseConversation(conv);
}

/**
 * Update conversation phase and metadata
 */
export function updateConversation(
  phoneNumber: string,
  phase: ConversationPhase,
  metadata: Partial<ConversationMetadata>,
): void {
  const existing = getOne<Conversation>(
    "SELECT * FROM conversations WHERE phone_number = ?",
    [phoneNumber],
  );

  if (!existing) {
    throw new Error(`Conversation not found: ${phoneNumber}`);
  }

  const currentMetadata = parseMetadata(existing.context_data);
  const mergedMetadata: ConversationMetadata = {
    ...currentMetadata,
    ...metadata,
    lastActivityAt: Date.now(),
  };

  // Map new state format to old state column for backwards compatibility
  const legacyState = mapPhaseToLegacyState(phase);

  // Update denormalized columns for dashboard queries
  const updates: Record<string, unknown> = {
    current_state: legacyState,
    context_data: JSON.stringify({
      phase: phase,
      metadata: mergedMetadata,
    }),
    last_activity_at: new Date().toISOString(),
  };

  // Sync denormalized fields for dashboard
  if (metadata.dni) updates.dni = metadata.dni;
  if (metadata.name) updates.client_name = metadata.name;
  if (metadata.segment) updates.segment = metadata.segment;
  if (metadata.credit !== undefined) updates.credit_line = metadata.credit;
  if (metadata.nse !== undefined) updates.nse = metadata.nse;
  if (metadata.age !== undefined) updates.age = metadata.age;

  if (phase.phase === "escalated") {
    updates.status = "human_takeover";
    updates.handover_reason = phase.reason;
  }

  const fields = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  const values = [...Object.values(updates), phoneNumber] as (
    | string
    | number
    | null
  )[];

  db.prepare(`UPDATE conversations SET ${fields} WHERE phone_number = ?`).run(
    ...values,
  );
}

/**
 * Mark conversation as escalated
 */
export function escalateConversation(
  phoneNumber: string,
  reason: string,
): void {
  updateConversation(phoneNumber, { phase: "escalated", reason }, {});
}

/**
 * Check if conversation is timed out (3+ hours inactive)
 */
export function isSessionTimedOut(metadata: ConversationMetadata): boolean {
  const hoursSince = (Date.now() - metadata.lastActivityAt) / (1000 * 60 * 60);
  return hoursSince >= 3;
}

/**
 * Reset session for returning user
 */
export function resetSession(
  phoneNumber: string,
  preserveCategory?: string,
): void {
  const now = Date.now();
  const newMetadata: ConversationMetadata = {
    isReturningUser: true,
    lastCategory: preserveCategory,
    createdAt: now,
    lastActivityAt: now,
  };

  db.prepare(
    `UPDATE conversations
     SET current_state = ?,
         context_data = ?,
         status = 'active',
         handover_reason = NULL,
         last_activity_at = CURRENT_TIMESTAMP
     WHERE phone_number = ?`,
  ).run(
    JSON.stringify(DEFAULT_PHASE),
    JSON.stringify({ phase: DEFAULT_PHASE, metadata: newMetadata }),
    phoneNumber,
  );
}

// --- Internal helpers ---

function parseConversation(conv: Conversation): ConversationData {
  const contextData = JSON.parse(conv.context_data || "{}");

  // Handle new format (phase + metadata stored in context_data)
  if (contextData.phase && contextData.metadata) {
    return {
      phoneNumber: conv.phone_number,
      phase: contextData.phase as ConversationPhase,
      metadata: contextData.metadata as ConversationMetadata,
      isSimulation: conv.is_simulation === 1,
    };
  }

  // Handle legacy format - migrate on read
  const phase = mapLegacyStateToPhase(conv.current_state, conv, contextData);
  const metadata: ConversationMetadata = {
    dni: conv.dni || undefined,
    name: conv.client_name || undefined,
    segment: conv.segment as "fnb" | "gaso" | undefined,
    credit: conv.credit_line || undefined,
    nse: conv.nse || undefined,
    lastCategory: contextData.offeredCategory || undefined,
    isReturningUser: contextData.isReturningUser || false,
    createdAt: Date.now(),
    lastActivityAt: new Date(conv.last_activity_at).getTime(),
  };

  return {
    phoneNumber: conv.phone_number,
    phase,
    metadata,
    isSimulation: conv.is_simulation === 1,
  };
}

function parseMetadata(contextDataJson: string | null): ConversationMetadata {
  const contextData = JSON.parse(contextDataJson || "{}");
  if (contextData.metadata) {
    return contextData.metadata;
  }
  return {
    createdAt: Date.now(),
    lastActivityAt: Date.now(),
  };
}

function mapLegacyStateToPhase(
  state: string,
  conv: Conversation,
  contextData: Record<string, unknown>,
): ConversationPhase {
  switch (state) {
    case "INIT":
      return { phase: "greeting" };
    case "CONFIRM_CLIENT":
      return { phase: "confirming_client" };
    case "COLLECT_DNI":
      return { phase: "collecting_dni" };
    case "WAITING_PROVIDER":
      return { phase: "checking_eligibility", dni: conv.dni || "" };
    case "COLLECT_AGE":
      return {
        phase: "collecting_age",
        dni: conv.dni || "",
        name: conv.client_name || "",
      };
    case "OFFER_PRODUCTS":
      return {
        phase: "offering_products",
        segment: (conv.segment as "fnb" | "gaso") || "fnb",
        credit: conv.credit_line || 0,
        name: conv.client_name || "",
      };
    case "HANDLE_OBJECTION":
      return {
        phase: "handling_objection",
        segment: (conv.segment as "fnb" | "gaso") || "fnb",
        credit: conv.credit_line || 0,
        name: conv.client_name || "",
        objectionCount: (contextData.objectionCount as number) || 1,
      };
    case "CLOSING":
      return { phase: "closing", purchaseConfirmed: false };
    default:
      return { phase: "greeting" };
  }
}

function mapPhaseToLegacyState(phase: ConversationPhase): string {
  switch (phase.phase) {
    case "greeting":
      return "INIT";
    case "confirming_client":
      return "CONFIRM_CLIENT";
    case "collecting_dni":
      return "COLLECT_DNI";
    case "checking_eligibility":
      return "WAITING_PROVIDER";
    case "collecting_age":
      return "COLLECT_AGE";
    case "offering_products":
      return "OFFER_PRODUCTS";
    case "handling_objection":
      return "HANDLE_OBJECTION";
    case "closing":
      return "CLOSING";
    case "escalated":
      return "CLOSING";
  }
}
