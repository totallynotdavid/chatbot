import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ fetch, locals, cookies }) => {
    if (!locals.user) {
        throw error(401, "Unauthorized");
    }

    const sessionToken = cookies.get("session");

    try {
        const res = await fetch("/api/system/logs?limit=100", {
            headers: sessionToken ? { cookie: `session=${sessionToken}` } : {}
        });

        if (!res.ok) {
            console.error("API Fetch Failed:", res.status, await res.text());
            throw new Error("Failed to fetch system logs");
        }

        const data = await res.json();

        return {
            logs: data.logs,
            user: locals.user,
        };
    } catch (err) {
        console.error("Error loading system logs:", err);
        return {
            logs: [],
            user: locals.user,
            error: "Could not load system logs",
        };
    }
};
