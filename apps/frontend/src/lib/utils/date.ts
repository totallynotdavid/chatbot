export function formatDate(date: string | Date | number): string {
    const d = new Date(date);
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
    }).format(d);
}

export function formatDateTime(date: string | Date | number): string {
    const d = new Date(date);
    return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
        hour12: true,
    }).format(d);
}
