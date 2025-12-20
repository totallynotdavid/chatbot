import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import {
    validateSessionToken,
    deleteSessionTokenCookie,
} from "../services/auth.ts";

export async function requireAuth(c: Context, next: Next) {
    const token = getCookie(c, "session");

    if (!token) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    const { session, user } = validateSessionToken(token);

    if (!session || !user) {
        deleteSessionTokenCookie(c);
        return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", user);
    c.set("session", session);

    await next();
}

export function requireRole(...allowedRoles: string[]) {
    return async (c: Context, next: Next) => {
        const user = c.get("user");

        if (!user || !allowedRoles.includes(user.role)) {
            return c.json({ error: "Forbidden" }, 403);
        }

        await next();
    };
}
