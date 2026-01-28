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
    const dniContext = ctx.dni ? ` (${ctx.dni})` : "";

    return [
      `${ident}${dniContext} espera atención.`,
      formatLink(ctx.urlSuffix || `/conversations/${ctx.phoneNumber}`),
    ].join("\n");
  },

  contractUploaded(ctx: NotificationContext): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);

    return [
      `${ident} subió su contrato.`,
      formatLink(ctx.urlSuffix || `/conversations/${ctx.phoneNumber}`),
    ].join("\n");
  },

  newOrder(
    ctx: NotificationContext,
    orderNumber: string,
    amount: number,
    productName?: string,
  ): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);
    const dniContext = ctx.dni ? ` (${ctx.dni})` : "";
    const money = b(`S/ ${amount.toFixed(2)}`);
    const product = productName ? ` Escogió: ${productName}` : "";

    return [
      `${ident}${dniContext} generó orden ${b(orderNumber)} por ${money}.${product}`,
      formatLink(ctx.urlSuffix),
    ].join("\n");
  },

  escalation(ctx: NotificationContext, reason: string): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);
    const dniContext = ctx.dni ? ` (${ctx.dni})` : "";

    return [
      `${ident}${dniContext} requiere atención.`,
      `Motivo: ${reason}`,
      formatLink(ctx.urlSuffix || `/conversations/${ctx.phoneNumber}`),
    ].join("\n");
  },

  attention(ctx: NotificationContext): string {
    const ident = b(ctx.clientName || ctx.phoneNumber);
    const dniContext = ctx.dni ? ` (${ctx.dni})` : "";

    return [
      `${ident}${dniContext} requiere revisión manual. Revisa la conversación.`,
      formatLink(ctx.urlSuffix || `/conversations/${ctx.phoneNumber}`),
    ].join("\n");
  },

  enrichmentLoop(ctx: NotificationContext): string {
    const ident = b(ctx.phoneNumber);
    return [
      `El ${ident} ha excedido el límite de bucles de enriquecimiento.`,
      `Conversación: ${formatLink(`/conversations/${ctx.phoneNumber}`)}`,
      `Logs: ${formatLink(`/dashboard/logs?phone=${ctx.phoneNumber}`)}`, // TODO: filter by phone is missing in frontend
    ].join("\n");
  },

  systemError(ctx: NotificationContext, error: string): string {
    const ident = b(ctx.phoneNumber);
    return [
      `Se ha producido un error con el ${ident}. Error: ${error}`,
      `Conversación: ${formatLink(`/conversations/${ctx.phoneNumber}`)}`,
      `Logs: ${formatLink(`/dashboard/logs?phone=${ctx.phoneNumber}`)}`,
    ].join("\n");
  },

  systemOutage(ctx: NotificationContext, errors: string[]): string {
    const ident = ctx.dni || "Unknown";
    return [
      `Proveedores no están funcionando. Cliente con DNI ${ident} se vio afectado.`,
      `Errors: ${errors.join(", ")}`,
      // Removed link as requested
    ].join("\n");
  },

  degradation(
    ctx: NotificationContext,
    failed: string,
    working: string,
  ): string {
    const ident = ctx.dni || "Unknown";
    return [
      `Proveedor *${failed}* está teniendo problemas. Se está usando *${working}* para el cliente con DNI ${ident}`,
      // Removed link as requested
    ].join("\n");
  },
};
