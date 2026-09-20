declare global {
  namespace App {
    interface Locals {
      user: {
        id: string;
        username: string;
        /**
         * Admin for a platform operator. Anyone else has their membership role
         * in the active tenant, or null while none is selected.
         */
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
