/**
 * Persistence layer for conversations-related data.
 * Stores ConversationPhase as discriminated union JSON.
 *
 * Every read and write is keyed by the full conversation identity
 * (tenant, channel account, contact number) - there is no lookup by phone
 * number alone, so one tenant can never reach another's conversation.
 */

import { db } from "../db/index.ts";
import { getOne } from "../db/query.ts";
import type { Conversation, ConversationRef } from "@totem/types";
import type { ConversationPhase, ConversationMetadata } from "@totem/core";

type ConversationData = {
  ref: ConversationRef;
  phoneNumber: string;
  phase: ConversationPhase;
  metadata: ConversationMetadata;
  isSimulation: boolean;
};

const DEFAULT_PHASE: ConversationPhase = { phase: "greeting" };

const IDENTITY_WHERE =
  "tenant_id = ? AND channel_account_id = ? AND phone_number = ?";

function identityParams(ref: ConversationRef): [string, string, string] {
  return [ref.tenantId, ref.channelAccountId, ref.phoneNumber];
}

export function findConversation(ref: ConversationRef): Conversation | null {
  return (
    getOne<Conversation>(
      `SELECT * FROM conversations WHERE ${IDENTITY_WHERE}`,
      identityParams(ref),
    ) ?? null
  );
}

/**
 * Get or create a conversation
 */
export function getOrCreateConversation(
  ref: ConversationRef,
  isSimulation = false,
): ConversationData {
  const conv = findConversation(ref);

  if (!conv) {
    const now = Date.now();
    const initialPhase = DEFAULT_PHASE;
    const initialMetadata: ConversationMetadata = {
      createdAt: now,
      lastActivityAt: now,
      phoneNumber: ref.phoneNumber,
    };

    db.prepare(
      `INSERT INTO conversations (tenant_id, channel_account_id, phone_number, context_data, status, is_simulation)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      ref.tenantId,
      ref.channelAccountId,
      ref.phoneNumber,
      JSON.stringify({ phase: initialPhase, metadata: initialMetadata }),
      "active",
      isSimulation ? 1 : 0,
    );

    return {
      ref,
      phoneNumber: ref.phoneNumber,
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
  ref: ConversationRef,
  phase: ConversationPhase,
  metadata: Partial<ConversationMetadata>,
): void {
  const existing = findConversation(ref);

  if (!existing) {
    throw new Error(
      `Conversation not found: ${ref.tenantId}/${ref.channelAccountId}/${ref.phoneNumber}`,
    );
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
  const values = [...Object.values(updates), ...identityParams(ref)] as (
    | string
    | number
    | null
  )[];

  db.prepare(`UPDATE conversations SET ${fields} WHERE ${IDENTITY_WHERE}`).run(
    ...values,
  );
}

/**
 * Mark conversation as escalated
 */
export function escalateConversation(
  ref: ConversationRef,
  reason: string,
): void {
  updateConversation(ref, { phase: "escalated", reason }, {});
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
  ref: ConversationRef,
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
     WHERE ${IDENTITY_WHERE}`,
  ).run(
    JSON.stringify({ phase: DEFAULT_PHASE, metadata: newMetadata }),
    ...identityParams(ref),
  );
}

/**
 * Identity of a stored conversation row: the inverse of `identityParams` above,
 * and here for the same reason - this module is where a conversation's identity
 * is expressed. It existed twice, byte for byte, the second copy being
 * `refOfConversation` in domains/conversations/read.ts; that one is gone and
 * everything (the read module and the routes) imports this one.
 */
export function refOf(conv: Conversation): ConversationRef {
  return {
    tenantId: conv.tenant_id,
    channelAccountId: conv.channel_account_id,
    phoneNumber: conv.phone_number,
  };
}

// --- Internal helpers ---

function parseConversation(conv: Conversation): ConversationData {
  const contextData = JSON.parse(conv.context_data || "{}");

  return {
    ref: refOf(conv),
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
