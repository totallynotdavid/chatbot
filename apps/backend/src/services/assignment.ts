import { db } from "../db/connection";

export async function assignNextAgent(
  phoneNumber: string,
  clientName: string | null,
): Promise<string | null> {
  // Get available sales agents
  const agents = db
    .prepare(
      `SELECT id, name, phone_number FROM users 
       WHERE role = 'sales_agent' AND is_active = 1 AND is_available = 1
       ORDER BY id`,
    )
    .all() as Array<{ id: string; name: string; phone_number: string | null }>;

  if (agents.length === 0) {
    console.warn("No available agents for assignment");
    return null;
  }

  // Get current counter from system_settings
  const setting = db
    .prepare("SELECT value FROM system_settings WHERE key = 'last_agent_index'")
    .get() as { value: string } | undefined;

  let currentIndex = setting ? parseInt(setting.value, 10) : 0;

  // Move to next agent (round-robin)
  currentIndex = (currentIndex + 1) % agents.length;

  // Update counter
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
    console.warn("Failed to get agent from index");
    return null;
  }

  // Update conversation
  db.prepare(
    `UPDATE conversations 
     SET assigned_agent = ?, assignment_notified_at = ?, status = 'human_takeover'
     WHERE phone_number = ?`,
  ).run(assignedAgent.id, Date.now(), phoneNumber);

  // Send notification to assigned agent's WhatsApp
  if (assignedAgent.phone_number) {
    const message =
      `🎯 Nueva asignación de cliente\n\n` +
      `Cliente: ${clientName || "Sin nombre"}\n` +
      `Teléfono: ${phoneNumber}\n\n` +
      `El cliente está listo para contratar.\n` +
      `Accede aquí: ${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard/conversations/${phoneNumber}\n\n` +
      `Tienes 5 minutos para aceptar esta asignación.`;

    // Send directly to agent's WhatsApp number
    const notifierUrl = process.env.NOTIFIER_URL || "http://localhost:3001";
    try {
      await fetch(`${notifierUrl}/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: "direct",
          phoneNumber: assignedAgent.phone_number,
          message,
        }),
      });
    } catch (error) {
      console.error("Failed to notify agent:", error);
    }
  }

  return assignedAgent.id;
}

export function checkAndReassignTimeouts(): void {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;

  // Find conversations assigned but not taken over within 5 minutes
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
    console.log(
      `Reassigning timed-out conversation: ${conv.phone_number} (was assigned to ${conv.assigned_agent})`,
    );

    // Reset assignment fields to allow reassignment
    db.prepare(
      `UPDATE conversations 
       SET assignment_notified_at = NULL, assigned_agent = NULL 
       WHERE phone_number = ?`,
    ).run(conv.phone_number);

    // Trigger new assignment
    assignNextAgent(conv.phone_number, conv.client_name);
  }
}
