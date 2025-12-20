import type { Context, Next } from "hono";

export async function securityHeaders(c: Context, next: Next) {
    await next();

    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");
    c.header("X-XSS-Protection", "1; mode=block");
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
}

// in-memory rate limiter
// application is internal, we don't need a complex algorithm
const requestCounts = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 100;

export async function rateLimiter(c: Context, next: Next) {
    const clientId =
        c.req.header("x-forwarded-for") ||
        c.req.header("x-real-ip") ||
        "unknown";
    const now = Date.now();

    let record = requestCounts.get(clientId);

    if (!record || now > record.resetAt) {
        record = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
        requestCounts.set(clientId, record);
    }

    record.count++;

    if (record.count > MAX_REQUESTS_PER_WINDOW) {
        return c.json({ error: "Rate limit exceeded" }, 429);
    }

    await next();
}
