export function buildHandleBacklogPrompt(
  message: string,
  ageMinutes: number,
): string {
  const sanitized = message.replace(/["\n\r]/g, " ").slice(0, 200);
  const timeAgo =
    ageMinutes < 60
      ? `${ageMinutes} minutos`
      : ageMinutes < 120
        ? "más de una hora"
        : `${Math.floor(ageMinutes / 60)} horas`;

  return `Mensaje del cliente hace ${timeAgo}: "${sanitized}"

Responde: reconoce brevemente la demora, responde al mensaje, continúa conversación.
2 líneas máximo, natural y amigable.

JSON: {"response": "respuesta"}`;
}
