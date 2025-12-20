import { browser } from "$app/environment";
import { fetchApi } from "$lib/utils/api";

type User = {
    username: string;
    role: string;
    name: string;
};

type AuthState = {
    user: User | null;
    isAuthenticated: boolean;
    isLoading: boolean;
};

function createAuthState() {
    let state = $state<AuthState>({
        user: null,
        isAuthenticated: false,
        isLoading: true,
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
        get canEdit() {
            return this.isAdmin || this.isDeveloper;
        },
        async checkAuth() {
            try {
                const data = await fetchApi<{ user: User | null }>(
                    "/api/auth/me",
                );
                state.user = data.user;
                state.isAuthenticated = Boolean(data.user);
            } catch {
                this.logout();
            } finally {
                state.isLoading = false;
            }
        },
        async logout() {
            try {
                await fetchApi("/api/auth/logout", { method: "POST" });
            } finally {
                state.user = null;
                state.isAuthenticated = false;
                if (browser && window.location.pathname !== "/login") {
                    window.location.href = "/login";
                }
            }
        },
    };
}

export const auth = createAuthState();
