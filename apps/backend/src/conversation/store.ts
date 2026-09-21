/**
 * Persistence layer for conversations-related data.
 * Stores ConversationPhase as discriminated union JSON.
 *
 * Every read and write is keyed by the full conversation identity: tenant,
 * channel account, and contact number. There is no lookup by phone number
 * alone, so the same contact in two tenants has two separate conversations.
 */

import { db } from "../db/index.ts";
import { getOne } from "../db/query.ts";
import type { Conversation, ConversationRef } from "@vendeya/types";
import type { ConversationPhase, ConversationMetadata } from "@vendeya/core";

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

  const updates: Record<string, unknown> = {
    context_data: JSON.stringify({
      phase: phase,
      metadata: mergedMetadata,
    }),
    last_activity_at: Date.now(),
  };

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

export function escalateConversation(
  ref: ConversationRef,
  reason: string,
): void {
  updateConversation(ref, { phase: "escalated", reason }, {});
}

/**
 * Writes neither the phase nor the status, so it needs no lock. A row without
 * valid JSON in `context_data` is left as it is, because `json_set` on NULL
 * returns NULL and would wipe the column.
 */
export function refreshLastActivity(ref: ConversationRef): void {
  const now = Date.now();

  db.prepare(
    `UPDATE conversations
     SET context_data = json_set(context_data, '$.metadata.lastActivityAt', ?),
         last_activity_at = ?
     WHERE ${IDENTITY_WHERE} AND json_valid(context_data)`,
  ).run(now, now, ...identityParams(ref));
}

export function isSessionTimedOut(metadata: ConversationMetadata): boolean {
  const hoursSince = (Date.now() - metadata.lastActivityAt) / (1000 * 60 * 60);
  return hoursSince >= 3;
}

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
         last_activity_at = ?
     WHERE ${IDENTITY_WHERE}`,
  ).run(
    JSON.stringify({ phase: DEFAULT_PHASE, metadata: newMetadata }),
    now,
    ...identityParams(ref),
  );
}

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
