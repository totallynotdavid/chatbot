import { browser } from "$app/environment";
import { fetchApi } from "$lib/utils/api";
import { showTenantSelector } from "$lib/state/tenant-switching";

type User = {
  username: string;
  /**
   * The role the session acts with. A platform operator is admin in every
   * scope. Anyone else has their role in the active tenant, null until one is
   * selected.
   */
  role: string | null;
  name: string;
  /** Whether the user takes new conversations in the active tenant. False while unpinned. */
  isAvailable?: boolean;
  /** VendeYa staff, who may act across tenants rather than inside one. */
  isPlatformOperator?: boolean;
  /**
   * Tenant the session is pinned to. Null means none is pinned: an operator
   * sees across tenants and a member has no scope yet.
   */
  activeTenantId?: string | null;
};

type Tenant = {
  id: string;
  slug: string;
  name: string;
  role: string | null;
};

type AuthState = {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  tenants: Tenant[];
};

function createAuthState() {
  let state = $state<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    tenants: [],
  });

  return {
    get user() {
      return state.user;
    },
    get isAuthenticated() {
      return state.isAuthenticated;
    },
    get isLoading() {
      return state.isLoading;
    },
    get isAdmin() {
      return state.user?.role === "admin";
    },
    get isDeveloper() {
      return state.user?.role === "developer";
    },
    get isSupervisor() {
      return state.user?.role === "supervisor";
    },
    get canEditCatalog() {
      return this.isAdmin || this.isDeveloper || this.isSupervisor;
    },
    get canApproveOrders() {
      return this.isAdmin || this.isSupervisor;
    },
    get canApproveCaliida() {
      return this.isAdmin;
    },
    get canAccessReports() {
      return this.isAdmin || this.isDeveloper || this.isSupervisor;
    },
    get canAccessSimulator() {
      return this.isAdmin || this.isDeveloper;
    },
    get canAccessProviders() {
      return this.isPlatformOperator;
    },
    get isSalesAgent() {
      return state.user?.role === "sales_agent";
    },
    get isPlatformOperator() {
      return state.user?.isPlatformOperator === true;
    },
    get activeTenantId() {
      return state.user?.activeTenantId ?? null;
    },
    get tenants() {
      return state.tenants;
    },
    get canSwitchTenant() {
      return showTenantSelector({
        tenantCount: state.tenants.length,
        activeTenantId: this.activeTenantId,
        isPlatformOperator: this.isPlatformOperator,
      });
    },
    get isAvailable() {
      return state.user?.isAvailable === true;
    },
    hydrate(user: User | null) {
      state.user = user;
      state.isAuthenticated = Boolean(user);
      state.isLoading = false;

      // The SSR payload does not carry the tenant list. Fetch it once the
      // client has a session so the scope indicator can render.
      if (user && browser) {
        void this.loadTenants();
      }
    },
    async checkAuth() {
      try {
        const data = await fetchApi<{ user: User | null }>("/api/auth/me");
        state.user = data.user;
        state.isAuthenticated = Boolean(data.user);
        if (data.user) {
          await this.loadTenants();
        }
      } catch {
        this.logout();
      } finally {
        state.isLoading = false;
      }
    },
    async loadTenants() {
      try {
        const data = await fetchApi<{
          tenants: Tenant[];
          activeTenantId: string | null;
        }>("/api/tenants");
        state.tenants = data.tenants;
        if (state.user) {
          state.user.activeTenantId = data.activeTenantId;
        }
      } catch {
        state.tenants = [];
      }
    },
    /**
     * Repoint the session at another tenant. The whole dashboard is scoped to
     * it, so the page is reloaded rather than trying to invalidate every store.
     */
    async selectTenant(tenantId: string | null) {
      await fetchApi("/api/tenants/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });

      if (browser) {
        window.location.reload();
      }
    },
    async logout() {
      try {
        await fetchApi("/api/auth/logout", { method: "POST" });
      } finally {
        state.user = null;
        state.isAuthenticated = false;
        state.tenants = [];
        if (browser && window.location.pathname !== "/login") {
          window.location.href = "/login";
        }
      }
    },
    async toggleAvailability() {
      if (!state.user) return;

      const newStatus = !state.user.isAvailable;
      try {
        await fetchApi("/api/auth/availability", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isAvailable: newStatus }),
        });

        if (state.user) {
          state.user.isAvailable = newStatus;
        }
      } catch (error) {
        console.error("Failed to toggle availability:", error);
      }
    },
  };
}

export const auth = createAuthState();
