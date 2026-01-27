/**
 * Persistence layer for conversations-related data.
 * Stores ConversationPhase as discriminated union JSON.
 */

import { db } from "../db/index.ts";
import { getOne } from "../db/query.ts";
import type { Conversation } from "@totem/types";
import type { ConversationPhase, ConversationMetadata } from "@totem/core";

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
      phoneNumber,
    };

    db.prepare(
      `INSERT INTO conversations (phone_number, context_data, status, is_simulation)
       VALUES (?, ?, ?, ?)`,
    ).run(
      phoneNumber,
      JSON.stringify({ phase: initialPhase, metadata: initialMetadata }),
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

  // Update denormalized columns for dashboard queries
  const updates: Record<string, unknown> = {
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
     SET context_data = ?,
         status = 'active',
         handover_reason = NULL,
         last_activity_at = CURRENT_TIMESTAMP
     WHERE phone_number = ?`,
  ).run(
    JSON.stringify({ phase: DEFAULT_PHASE, metadata: newMetadata }),
    phoneNumber,
  );
}

// --- Internal helpers ---

function parseConversation(conv: Conversation): ConversationData {
  const contextData = JSON.parse(conv.context_data || "{}");

  return {
    phoneNumber: conv.phone_number,
    phase: contextData.phase as ConversationPhase,
    metadata: {
      ...contextData.metadata,
      phoneNumber: conv.phone_number,
    } as ConversationMetadata,
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
