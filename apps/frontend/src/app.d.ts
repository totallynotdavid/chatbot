declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
        username: string;
        /** Role in the session's active tenant; null when none is selected. */
        role: string | null;
        name: string;
        /** VendeYa staff, who act across tenants rather than inside one. */
        isPlatformOperator: boolean;
        /** Tenant the session is currently scoped to, if any. */
        activeTenantId: string | null;
      } | null;
    }
  }
}

export {};
