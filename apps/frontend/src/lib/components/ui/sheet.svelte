<script lang="ts">
    import { fade, fly } from "svelte/transition";

    export let open = false;
    export let title = "";
    export let description = "";
    export let onclose: () => void = () => {};

    function close() {
        onclose();
    }
</script>

{#if open}
    <div class="fixed inset-0 z-50 overflow-hidden">
        <!-- Backdrop -->
        <div
            class="absolute inset-0 bg-ink-900/20 backdrop-blur-sm transition-opacity cursor-default"
            transition:fade={{ duration: 200 }}
            on:click={close}
            on:keydown={(e) => e.key === "Escape" && close()}
            role="button"
            tabindex="0"
        ></div>

        <!-- Panel -->
        <div
            class="fixed inset-y-0 right-0 max-w-2xl w-full flex pointer-events-none"
        >
            <div
                class="w-full h-full bg-white shadow-2xl pointer-events-auto transform transition font-sans flex flex-col"
                transition:fly={{ x: 400, duration: 300 }}
            >
                <!-- Header -->
                <div
                    class="px-6 py-4 border-b border-ink-100 flex items-center justify-between bg-cream-50"
                >
                    <div>
                        {#if title}
                            <h2 class="text-lg font-serif text-ink-900">
                                {title}
                            </h2>
                        {/if}
                        {#if description}
                            <p class="text-xs text-ink-500 mt-1">
                                {description}
                            </p>
                        {/if}
                    </div>
                    <button
                        class="text-ink-400 hover:text-ink-900 transition-colors p-1"
                        on:click={close}
                        aria-label="Close details"
                    >
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-6 w-6"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                        >
                            <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>

                <!-- Content -->
                <div class="flex-1 overflow-y-auto p-6 space-y-6">
                    <slot />
                </div>

                <!-- Footer -->
                {#if $$slots.footer}
                    <div
                        class="border-t border-ink-100 px-6 py-4 bg-cream-50 flex justify-end gap-3"
                    >
                        <slot name="footer" />
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
