import { browser } from "$app/environment";

type AuthResponse = {
    user: { username: string; role: string } | null;
};

export const user = $state({
    data: null as null | { username: string; role: string },
    isAuthenticated: false,

    async checkAuth() {
        try {
            const res = await fetch("/api/auth/me");
            if (res.ok) {
                const json = (await res.json()) as AuthResponse;
                this.data = json.user;
                this.isAuthenticated = true;
            } else {
                this.logout();
            }
        } catch {
            this.logout();
        }
    },

    async logout() {
        await fetch("/api/auth/logout", { method: "POST" });
        this.data = null;
        this.isAuthenticated = false;
        if (browser && window.location.pathname !== "/login") {
            window.location.href = "/login";
        }
    },
});
