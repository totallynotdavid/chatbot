<script lang="ts">
import { toasts } from "$lib/toast.svelte";
import { fly } from "svelte/transition";
import { cubicOut } from "svelte/easing";

function dismiss(id: string) {
    toasts.remove(id);
}
</script>

<div class="toast-container">
    {#each toasts.items as toast (toast.id)}
        <div 
            class="toast toast-{toast.type}"
            transition:fly={{ y: 20, duration: 400, easing: cubicOut }}
        >
            <div class="toast-content">
                {#if toast.type === "success"}
                    <div class="toast-icon text-green-600">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                    </div>
                {:else if toast.type === "error"}
                    <div class="toast-icon text-red-600">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </div>
                {:else}
                    <div class="toast-icon text-ink-400">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="16" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                        </svg>
                    </div>
                {/if}
                <span class="toast-message">{toast.message}</span>
            </div>
            <button onclick={() => dismiss(toast.id)} class="toast-dismiss" aria-label="Cerrar">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
        </div>
    {/each}
</div>

<style>
.toast-container {
    position: fixed;
    bottom: 2rem;
    right: 2rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: auto;
    pointer-events: none;
    align-items: flex-end;
}

.toast {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.75rem 1.25rem;
    background: white;
    border: 1px solid var(--color-ink-100);
    border-radius: 9999px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
    pointer-events: auto;
    min-width: 300px;
    max-width: 450px;
}

.toast-content {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
}

.toast-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
}

.toast-message {
    font-family: 'Inter', sans-serif;
    font-size: 0.875rem;
    font-weight: 500;
    color: var(--color-ink-900);
    letter-spacing: -0.01em;
}

.toast-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-ink-300);
    padding: 0.25rem;
    border-radius: 50%;
    transition: all 0.2s;
}

.toast-dismiss:hover {
    background-color: var(--color-ink-50);
    color: var(--color-ink-900);
}
</style>
