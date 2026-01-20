import { setupEventSubscribers } from "./event-bus-setup.ts";

export function initializeApplication(): void {
  setupEventSubscribers();
}
