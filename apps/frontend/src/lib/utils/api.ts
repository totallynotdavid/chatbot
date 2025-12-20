type FetchOptions = RequestInit & {
    params?: Record<string, string>;
};

export async function fetchApi<T>(
    endpoint: string,
    options: FetchOptions = {},
): Promise<T> {
    const { params, ...init } = options;

    let url = endpoint;
    if (params) {
        const query = new URLSearchParams(params).toString();
        url = `${endpoint}?${query}`;
    }

    const response = await fetch(url, init);

    if (!response.ok) {
        const error = await response
            .json()
            .catch(() => ({ error: "Request failed" }));
        throw new Error(error.error || `HTTP ${response.status}`);
    }

    return response.json();
}

export function createFormData(data: Record<string, any>): FormData {
    const form = new FormData();

    for (const [key, value] of Object.entries(data)) {
        if (value !== null && value !== undefined) {
            if (value instanceof File) {
                form.append(key, value);
            } else if (typeof value === "object") {
                form.append(key, JSON.stringify(value));
            } else {
                form.append(key, String(value));
            }
        }
    }

    return form;
}
