import { getFrontendUrl } from "@totem/utils";

export type NotificationContext = {
  phoneNumber: string;
  clientName?: string | null;
  dni?: string | null;
  details?: string;
  urlSuffix?: string;
};

function formatLink(suffix?: string): string {
  const baseUrl = getFrontendUrl();
  if (!suffix) return "";
  return `${baseUrl}/dashboard${suffix}`;
}

function b(text: string): string {
  return `*${text}*`;
}

export const templates = {
  assignment(ctx: NotificationContext): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);
    const phone = ctx.clientName ? ` (${ctx.phoneNumber})` : "";

    return [
      `${ident}${phone} espera atención.`,
      formatLink(ctx.urlSuffix || `/conversations/${ctx.phoneNumber}`),
    ].join("\n");
  },

  newOrder(
    ctx: NotificationContext,
    orderNumber: string,
    amount: number,
  ): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);
    const money = b(`S/ ${amount.toFixed(2)}`);

    return [
      `${ident} generó orden ${b(orderNumber)} por ${money}.`,
      formatLink(ctx.urlSuffix),
    ].join("\n");
  },

  contractUploaded(ctx: NotificationContext, agentName: string): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);

    return [
      `${ident} subió su contrato (Agente: ${agentName}).`,
      formatLink(ctx.urlSuffix || `/conversations/${ctx.phoneNumber}`),
    ].join("\n");
  },

  systemOutage(ctx: NotificationContext, errors: string[]): string {
    return [
      `[Alerta] Sistema caído para DNI ${ctx.dni}`,
      ...errors.map((e) => `- ${e}`),
    ].join("\n");
  },

  degradation(ctx: NotificationContext, details: string): string {
    const context = ctx.dni ? ` (DNI: ${ctx.dni})` : "";
    return [`[Alerta] Degradación${context}`, details].join("\n");
  },

  error(ctx: NotificationContext, errorDetails: string): string {
    const ident = ctx.phoneNumber ? `(${ctx.phoneNumber})` : "";
    return [`[Error] Procesamiento ${ident}`, errorDetails].join("\n");
  },

  generic(ctx: NotificationContext, message: string): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);

    return [`[Notificación] ${ident}`, message, formatLink(ctx.urlSuffix)].join(
      "\n",
    );
  },
};
