import { db } from "../../db/index.ts";
import { createLogger } from "../../lib/logger.ts";
import { getFrontendUrl, getNotifierUrl } from "@totem/utils";

const logger = createLogger("assignment");

type Agent = {
  id: string;
  name: string;
  phone_number: string | null;
};

export async function assignNextAgent(
  phoneNumber: string,
  clientName: string | null,
): Promise<string | null> {
  const agents = db
    .prepare(
      `SELECT id, name, phone_number FROM users 
       WHERE role = 'sales_agent' AND is_active = 1 AND is_available = 1
       ORDER BY id`,
    )
    .all() as Agent[];

  if (agents.length === 0) {
    logger.warn("No available agents");
    return null;
  }

  const setting = db
    .prepare("SELECT value FROM system_settings WHERE key = 'last_agent_index'")
    .get() as { value: string } | undefined;

  let currentIndex = setting ? parseInt(setting.value, 10) : 0;
  currentIndex = (currentIndex + 1) % agents.length;

  if (setting) {
    db.prepare(
      "UPDATE system_settings SET value = ?, updated_at = ? WHERE key = 'last_agent_index'",
    ).run(currentIndex.toString(), Date.now());
  } else {
    db.prepare(
      "INSERT INTO system_settings (key, value, updated_at) VALUES (?, ?, ?)",
    ).run("last_agent_index", currentIndex.toString(), Date.now());
  }

  const assignedAgent = agents[currentIndex];

  if (!assignedAgent) {
    logger.warn(
      { currentIndex, agentCount: agents.length },
      "Failed to get agent from index",
    );
    return null;
  }

  db.prepare(
    `UPDATE conversations 
     SET assigned_agent = ?, assignment_notified_at = ?, status = 'human_takeover'
     WHERE phone_number = ?`,
  ).run(assignedAgent.id, Date.now(), phoneNumber);

  if (assignedAgent.phone_number) {
    await sendAssignmentNotification(
      assignedAgent.phone_number,
      clientName,
      phoneNumber,
    );
  }

  return assignedAgent.id;
}

async function sendAssignmentNotification(
  agentPhone: string,
  clientName: string | null,
  clientPhone: string,
): Promise<void> {
  const frontendUrl = getFrontendUrl();
  const message =
    `🚨 NUEVA ASIGNACIÓN\n\n` +
    `Nombre: ${clientName || "No disponible"}\n` +
    `DNI: No disponible\n` +
    `Teléfono: ${clientPhone}\n` +
    `Producto: No disponible\n\n` +
    `Cliente listo para venta. Ver detalles:\n` +
    `${frontendUrl}/dashboard/conversations/${clientPhone}\n\n` +
    `Aceptar en 5 minutos.`;

  const notifierUrl = getNotifierUrl();

  try {
    await fetch(`${notifierUrl}/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "direct",
        phoneNumber: agentPhone,
        message,
      }),
    });
  } catch (error) {
    logger.error({ error, agentPhone, clientPhone }, "Failed to notify agent");
  }
}

export function checkAndReassignTimeouts(): void {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  const timedOutConversations = db
    .prepare(
      `SELECT phone_number, client_name, assigned_agent 
       FROM conversations 
       WHERE assignment_notified_at IS NOT NULL 
         AND assignment_notified_at < ?
         AND status = 'human_takeover'
         AND handover_reason IS NULL`,
    )
    .all(fiveMinutesAgo) as Array<{
    phone_number: string;
    client_name: string | null;
    assigned_agent: string | null;
  }>;

  for (const conv of timedOutConversations) {
    logger.info(
      { phoneNumber: conv.phone_number, previousAgent: conv.assigned_agent },
      "Reassigning timed-out conversation",
    );

    db.prepare(
      `UPDATE conversations 
       SET assignment_notified_at = NULL, assigned_agent = NULL 
       WHERE phone_number = ?`,
    ).run(conv.phone_number);

    assignNextAgent(conv.phone_number, conv.client_name);
  }
}
