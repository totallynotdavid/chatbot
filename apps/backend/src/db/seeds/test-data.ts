import type { Database } from "bun:sqlite";
import type { ConversationStatus, SaleStatus, Segment } from "@totem/types";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

type TestMessage = {
  role: "incoming" | "outgoing";
  text: string;
  offsetMs: number;
};

type TestConversation = {
  phoneNumber: string;
  clientName: string;
  dni: string;
  segment: Segment;
  creditLine: number;
  status: ConversationStatus;
  messages: TestMessage[];
  assignedAgent?: string;
  saleStatus?: SaleStatus;
  assignmentNotifiedAt?: number;
};

const TEST_CONVERSATIONS: TestConversation[] = [
  {
    phoneNumber: "+51999888777",
    clientName: "Juan Pérez",
    dni: "12345678",
    segment: "fnb" as const,
    creditLine: 5000,
    status: "active" as const,
    messages: [
      { role: "incoming" as const, text: "Hola", offsetMs: -60 * MINUTE_MS },
      {
        role: "outgoing" as const,
        text: "¡Qué tal! Somos Cálidda. ¿Tu servicio de gas está a tu nombre?",
        offsetMs: -58 * MINUTE_MS,
      },
      { role: "incoming" as const, text: "Sí", offsetMs: -50 * MINUTE_MS },
      {
        role: "outgoing" as const,
        text: "Genial 😊. Por favor, indícame tu DNI para verificar tus beneficios.",
        offsetMs: -48 * MINUTE_MS,
      },
      {
        role: "incoming" as const,
        text: "12345678",
        offsetMs: -40 * MINUTE_MS,
      },
      {
        role: "outgoing" as const,
        text: "Perfecto. Tienes una línea de crédito de S/ 5,000. Te puedo ofrecer productos financieros.",
        offsetMs: -35 * MINUTE_MS,
      },
    ],
  },
  {
    phoneNumber: "+51999888888",
    clientName: "Ana Torres",
    dni: "87654321",
    segment: "gaso" as const,
    creditLine: 2500,
    status: "closed" as const,
    assignedAgent: "agent-001",
    saleStatus: "confirmed" as const,
    messages: [
      {
        role: "incoming" as const,
        text: "Buenos días",
        offsetMs: -2 * HOUR_MS,
      },
      {
        role: "outgoing" as const,
        text: "¡Hola! Somos Cálidda. ¿El servicio de gas está a tu nombre?",
        offsetMs: -2 * HOUR_MS + 2 * MINUTE_MS,
      },
      {
        role: "incoming" as const,
        text: "Sí es mío",
        offsetMs: -2 * HOUR_MS + 10 * MINUTE_MS,
      },
      {
        role: "outgoing" as const,
        text: "Perfecto. Indícame tu DNI para verificar tus beneficios.",
        offsetMs: -2 * HOUR_MS + 12 * MINUTE_MS,
      },
      {
        role: "incoming" as const,
        text: "87654321",
        offsetMs: -2 * HOUR_MS + 20 * MINUTE_MS,
      },
      {
        role: "outgoing" as const,
        text: "Tienes una línea de crédito de S/ 2,500! Te puedo mostrar equipos disponibles.",
        offsetMs: -2 * HOUR_MS + 25 * MINUTE_MS,
      },
    ],
  },
];

export async function seedTestData(db: Database) {
  const exists = db
    .prepare("SELECT count(*) as count FROM conversations")
    .get() as { count: number };

  if (exists.count > 0) {
    return;
  }

  const now = Date.now();
  const conversationStmt = db.prepare(
    `INSERT INTO conversations (
      phone_number, client_name, dni, segment, credit_line, status,
      assigned_agent, assignment_notified_at, is_simulation,
      last_activity_at, context_data, sale_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const messageStmt = db.prepare(
    `INSERT INTO messages (
      id, phone_number, direction, type, content, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const conversation of TEST_CONVERSATIONS) {
    const lastActivityAt =
      now + conversation.messages[conversation.messages.length - 1]!.offsetMs;
    const assignmentNotifiedAt = conversation.assignmentNotifiedAt
      ? now + conversation.assignmentNotifiedAt
      : null;

    const contextData = {
      phase: {
        phase:
          conversation.status === "human_takeover" ||
          conversation.status === "closed"
            ? "closing"
            : "offering_products",
        segment: conversation.segment,
        credit: conversation.creditLine,
        name: conversation.clientName,
        ...(conversation.status === "human_takeover" ||
        conversation.status === "closed"
          ? { purchaseConfirmed: true }
          : {}),
      },
      metadata: {
        dni: conversation.dni,
        name: conversation.clientName,
        segment: conversation.segment,
        credit: conversation.creditLine,
        createdAt: now,
        lastActivityAt,
      },
    };

    conversationStmt.run(
      conversation.phoneNumber,
      conversation.clientName,
      conversation.dni,
      conversation.segment,
      conversation.creditLine,
      conversation.status,
      conversation.assignedAgent || null,
      assignmentNotifiedAt,
      0,
      lastActivityAt,
      JSON.stringify(contextData),
      conversation.saleStatus || "pending",
    );

    for (const message of conversation.messages) {
      const messageId = `msg-${crypto.randomUUID()}`;
      const direction = message.role === "incoming" ? "inbound" : "outbound";
      const createdAt = now + message.offsetMs;

      messageStmt.run(
        messageId,
        conversation.phoneNumber,
        direction,
        "text",
        message.text,
        createdAt,
      );
    }
  }
}
