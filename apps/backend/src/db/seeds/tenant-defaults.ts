/**
 * The default tenant is Totem, the business this codebase was built for. Its
 * channel account is seeded from the WHATSAPP_* environment variables.
 */
export const DEFAULT_TENANT_SLUG = "totem";
export const DEFAULT_TENANT_NAME = "Totem";

/** `phone_number_id` is unique across tenants, so a placeholder names its tenant. */
export function unconfiguredPhoneNumberId(tenantId: string): string {
  return `unconfigured:${tenantId}`;
}
