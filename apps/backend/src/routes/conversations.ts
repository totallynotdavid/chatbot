import { Hono } from "hono";
import { pathParam } from "../lib/http.ts";
import type { Context } from "hono";
import type { Conversation } from "@vendeya/types";
import * as ConversationRead from "../domains/conversations/read.ts";
import {
  ConversationBusyError,
  LockTimeoutError,
} from "../conversation/locks.ts";
import { refOf } from "../conversation/store.ts";
import * as ConversationWrite from "../domains/conversations/write.ts";
import * as ConversationMedia from "../domains/conversations/media.ts";
import { assignNextAgent } from "../domains/conversations/assignment.ts";
import { requireActiveTenant, requireTenantScope } from "../middleware/auth.ts";

const conversations = new Hono();

// Reads span tenants for a platform operator who has not pinned one. Writes
// also take `requireActiveTenant`, because a write must land in a tenant the
// caller has selected.
conversations.use("/*", requireTenantScope);

/**
 * Resolves `:phone` within the caller's scope: the pinned tenant, or every open
 * tenant for an unpinned platform operator. A conversation outside that scope
 * is indistinguishable from one that does not exist.
 */
function resolve(
  c: Context,
): { conversation: Conversation } | { error: Response } {
  const lookup = ConversationRead.lookupConversation(
    c.get("scope"),
    pathParam(c, "phone"),
    c.req.query("channel") ?? null,
  );

  if (lookup.status === "found") {
    return { conversation: lookup.conversation };
  }

  // The same contact can talk to two numbers in scope. `?channel=` picks the
  // thread. Without it the request is refused instead of answered with
  // whichever thread was touched last.
  if (lookup.status === "ambiguous") {
    return {
      error: c.json(
        {
          error: "Ambiguous conversation",
          detail:
            "This contact is talking to more than one of your numbers; pass ?channel=<channel_account_id>",
          channels: lookup.candidates.map((conv) => ({
            channelAccountId: conv.channel_account_id,
            lastActivityAt: conv.last_activity_at,
          })),
        },
        409,
      ),
    };
  }

  return { error: c.json({ error: "Conversation not found" }, 404) };
}

/**
 * A lock wait that runs out is answered as busy. After `LockTimeoutError` the
 * change may still land, and repeating a takeover or a release is harmless.
 */
function refuseIfBusy(c: Context, error: unknown): Response {
  if (
    error instanceof ConversationBusyError ||
    error instanceof LockTimeoutError
  ) {
    return c.json(
      { error: "The conversation is busy. Try again in a moment." },
      409,
    );
  }
  throw error;
}

conversations.get("/", (c) => {
  const scope = c.get("scope");
  const status = c.req.query("status");

  const rows = ConversationRead.listConversations(scope, status);
  return c.json(rows);
});

conversations.get("/:phone", (c) => {
  const found = resolve(c);
  if ("error" in found) return found.error;

  return c.json(ConversationRead.getConversationDetail(found.conversation));
});

conversations.post("/:phone/takeover", requireActiveTenant, async (c) => {
  const found = resolve(c);
  if ("error" in found) return found.error;
  const conv = found.conversation;

  const user = c.get("user");

  try {
    const result = await ConversationWrite.takeoverConversation(
      refOf(conv),
      user.id,
    );
    return c.json(result);
  } catch (error) {
    return refuseIfBusy(c, error);
  }
});

conversations.post("/:phone/message", requireActiveTenant, async (c) => {
  const found = resolve(c);
  if ("error" in found) return found.error;
  const conv = found.conversation;

  const { content } = await c.req.json();
  const user = c.get("user");

  const result = await ConversationWrite.sendManualMessage(
    refOf(conv),
    content,
    user.id,
  );

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json(result);
});

conversations.post("/:phone/release", requireActiveTenant, async (c) => {
  const found = resolve(c);
  if ("error" in found) return found.error;
  const conv = found.conversation;

  const user = c.get("user");

  try {
    const result = await ConversationWrite.releaseConversation(
      refOf(conv),
      user.id,
    );
    return c.json(result);
  } catch (error) {
    return refuseIfBusy(c, error);
  }
});

conversations.post(
  "/:phone/decline-assignment",
  requireActiveTenant,
  async (c) => {
    const found = resolve(c);
    if ("error" in found) return found.error;
    const conv = found.conversation;

    const user = c.get("user");
    const ref = refOf(conv);
    const result = ConversationWrite.declineAssignment(ref, user.id);

    if (!result.success) {
      return c.json({ error: result.error }, 403);
    }

    if (result.clientName !== undefined) {
      await assignNextAgent(ref, result.clientName);
    }

    return c.json({ success: true });
  },
);

conversations.patch("/:phone/agent-data", requireActiveTenant, async (c) => {
  const found = resolve(c);
  if ("error" in found) return found.error;
  const conv = found.conversation;

  const user = c.get("user");
  const updates = await c.req.json();

  const result = ConversationWrite.updateAgentData(
    refOf(conv),
    user.id,
    updates,
  );

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json(result);
});

conversations.get("/:phone/replay", (c) => {
  const user = c.get("user");

  if (user.role !== "admin" && user.role !== "developer") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const found = resolve(c);
  if ("error" in found) return found.error;
  const conv = found.conversation;

  const replayData = ConversationRead.getReplayData(conv, user.id);

  if (!replayData) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  return c.json(replayData);
});

conversations.post(
  "/:phone/upload-contract",
  requireActiveTenant,
  async (c) => {
    const found = resolve(c);
    if ("error" in found) return found.error;
    const conv = found.conversation;

    const user = c.get("user");
    const formData = await c.req.formData();

    const contractFile = formData.get("contract") as File | null;
    const audioFile = formData.get("audio") as File | null;

    if (!contractFile || !audioFile) {
      return c.json({ error: "Contract and audio files required" }, 400);
    }

    const result = await ConversationMedia.uploadContract({
      ref: refOf(conv),
      userId: user.id,
      contractFile,
      audioFile,
      clientName: formData.get("clientName") as string | undefined,
      userDisplayName: user.name,
    });

    return c.json(result);
  },
);

export default conversations;
