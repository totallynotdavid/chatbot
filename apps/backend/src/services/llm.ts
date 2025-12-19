import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const MODEL = "gemini-2.0-flash";

export async function classifyIntent(
    message: string,
): Promise<"yes" | "no" | "question" | "unclear"> {
    try {
        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content:
                        'Classify intent. JSON: {"intent": "yes"|"no"|"question"|"unclear"}',
                },
                { role: "user", content: message },
            ],
            response_format: { type: "json_object" },
        });
        const choice = completion.choices[0];
        const content = choice?.message.content;
        const res = JSON.parse(content || "{}");
        return res.intent || "unclear";
    } catch {
        return "unclear";
    }
}

export async function extractEntity(
    message: string,
    entity: string,
): Promise<string | null> {
    try {
        const completion = await client.chat.completions.create({
            model: MODEL,
            messages: [
                {
                    role: "system",
                    content: `Extract ${entity}. JSON: {"value": string|number|null}`,
                },
                { role: "user", content: message },
            ],
            response_format: { type: "json_object" },
        });
        const choice = completion.choices[0];
        const content = choice?.message.content;
        const res = JSON.parse(content || "{}");
        return res.value ? String(res.value) : null;
    } catch {
        return null;
    }
}
