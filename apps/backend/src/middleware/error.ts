import type { Context } from "hono";
import process from "node:process";

export async function errorHandler(err: Error, c: Context) {
    console.error("Unhandled error:", err);

    const isDev = process.env.NODE_ENV !== "production";

    return c.json(
        {
            error: "Internal server error",
            message: isDev ? err.message : undefined,
            stack: isDev ? err.stack : undefined,
        },
        500,
    );
}
