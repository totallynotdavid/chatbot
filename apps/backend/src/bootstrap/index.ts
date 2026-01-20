import { setupEventSubscribers } from "./bootstrap/event-bus-setup.ts";

export function initializeApplication(): void {
    // Wire up all event subscribers
    setupEventSubscribers();
}
