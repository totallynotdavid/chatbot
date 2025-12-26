import process from "node:process";

const NOTIFIER_URL = process.env.NOTIFIER_URL || "http://localhost:3001";

type NotifyRequest = {
    channel: "agent" | "dev" | "sales";
    message: string;
};

export async function notifyTeam(
    channel: "agent" | "dev" | "sales",
    message: string,
): Promise<boolean> {
    try {
        const response = await fetch(`${NOTIFIER_URL}/notify`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel, message } as NotifyRequest),
        });

        return response.ok;
    } catch (error) {
        console.error("Notifier service error:", error);
        return false;
    }
}

export async function checkNotifierHealth(): Promise<boolean> {
    try {
        const response = await fetch(`${NOTIFIER_URL}/health`, {
            method: "GET",
        });
        return response.ok;
    } catch {
        return false;
    }
}
