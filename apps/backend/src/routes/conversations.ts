import { Hono } from "hono";
import { logAction } from "../services/audit.ts";
import * as ConversationRead from "../modules/conversation/read.ts";
import type { Role } from "../modules/conversation/read.ts";
import * as ConversationWrite from "../modules/conversation/write.ts";
import * as ConversationMedia from "../modules/conversation/media.ts";
import { assignNextAgent } from "../modules/conversation/assignment.ts";

const conversations = new Hono();

conversations.get("/", (c) => {
  const user = c.get("user");
  const status = c.req.query("status");
  const rows = ConversationRead.listConversations(status, user.role as Role, user.id);
  return c.json(rows);
});

conversations.get("/:phone", (c) => {
  const phoneNumber = c.req.param("phone");
  const data = ConversationRead.getConversationDetail(phoneNumber);

  if (!data) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  return c.json(data);
});

conversations.post("/:phone/takeover", (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");
  const result = ConversationWrite.takeoverConversation(phoneNumber, user.id);
  return c.json(result);
});

conversations.post("/:phone/message", async (c) => {
  const phoneNumber = c.req.param("phone");
  const { content } = await c.req.json();
  const user = c.get("user");

  try {
    const result = await ConversationWrite.sendManualMessage(
      phoneNumber,
      content,
      user.id,
    );
    return c.json(result);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

conversations.post("/:phone/release", (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");
  const result = ConversationWrite.releaseConversation(phoneNumber, user.id);
  return c.json(result);
});

conversations.post("/:phone/decline-assignment", async (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");
  const result = await ConversationWrite.declineAssignment(
    phoneNumber,
    user.id,
  );

  if (!result.success) {
    return c.json({ error: result.error }, 403);
  }

  if (result.shouldReassign && result.clientName !== undefined) {
    await assignNextAgent(phoneNumber, result.clientName);
  }

  return c.json({ success: true });
});

conversations.patch("/:phone/agent-data", async (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");
  const updates = await c.req.json();

  const result = ConversationWrite.updateAgentData(
    phoneNumber,
    user.id,
    updates,
  );

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }

  return c.json(result);
});

conversations.get("/:phone/replay", (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");

  if (user.role !== "admin" && user.role !== "developer") {
    return c.json({ error: "Forbidden" }, 403);
  }

  const replayData = ConversationRead.getReplayData(phoneNumber);

  if (!replayData) {
    return c.json({ error: "Conversation not found" }, 404);
  }

  logAction(user.id, "export_replay", "conversation", phoneNumber);

  return c.json(replayData);
});

conversations.post("/:phone/upload-contract", async (c) => {
  const phoneNumber = c.req.param("phone");
  const user = c.get("user");
  const formData = await c.req.formData();

  const contractFile = formData.get("contract") as File | null;
  const audioFile = formData.get("audio") as File | null;

  if (!contractFile || !audioFile) {
    return c.json({ error: "Contract and audio files required" }, 400);
  }

  const result = await ConversationMedia.uploadContract({
    phoneNumber,
    userId: user.id,
    contractFile,
    audioFile,
    clientName: formData.get("clientName") as string | undefined,
    userDisplayName: user.name,
  });

  return c.json(result);
});

export default conversations;
