<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
    open: boolean;
    title?: string;
    subtitle?: string;
    onClose: () => void;
    children: Snippet;
    footer?: Snippet;
};

let { open = $bindable(), title, subtitle, onClose, children, footer }: Props = $props();
let modalRef: HTMLDivElement | undefined = $state();
let previousActiveElement: Element | null = null;

const modalId = `modal-${Math.random().toString(36).slice(2, 9)}`;
const titleId = $derived(title ? `${modalId}-title` : undefined);

// Focus management and ESC key handler
$effect(() => {
    if (!open) return;

    // Store previous active element
    previousActiveElement = document.activeElement;

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        }

        // Basic focus trap
        if (e.key === "Tab" && modalRef) {
            const focusableElements = modalRef.querySelectorAll<HTMLElement>(
                'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
            );
            const firstElement = focusableElements[0];
            const lastElement = focusableElements[focusableElements.length - 1];

            if (e.shiftKey && document.activeElement === firstElement) {
                e.preventDefault();
                lastElement?.focus();
            } else if (!e.shiftKey && document.activeElement === lastElement) {
                e.preventDefault();
                firstElement?.focus();
            }
        }
    };

    document.addEventListener("keydown", handleKeydown);
    
    return () => {
        document.removeEventListener("keydown", handleKeydown);
        // Return focus to previous element
        if (previousActiveElement && previousActiveElement instanceof HTMLElement) {
            previousActiveElement.focus();
        }
    };
});

// Click outside handler
function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
        onClose();
    }
}
</script>

{#if open}
    <div 
        class="fixed inset-0 z-50" 
        onclick={handleOverlayClick}
        role="presentation"
    >
        <!-- Overlay -->
        <div class="absolute inset-0 bg-white/80 backdrop-blur-sm" aria-hidden="true"></div>
        
        <!-- Modal -->
        <div 
            bind:this={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            class="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white border border-ink-200 shadow-xl max-w-2xl w-[calc(100%-4rem)] max-h-[90vh] flex flex-col focus-visible:outline-none"
        >
            <div class="flex justify-between items-start p-8 border-b border-ink-100">
                <div>
                    {#if subtitle}
                        <span class="block text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2">{subtitle}</span>
                    {/if}
                    {#if title}
                        <h2 id={titleId} class="text-3xl font-serif text-ink-900">{title}</h2>
                    {/if}
                </div>
                <button 
                    type="button"
                    onclick={onClose}
                    class="text-ink-400 hover:text-ink-900 hover:bg-ink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 p-2 min-w-10 min-h-10 rounded-full transition-colors -mt-2 -mr-2 touch-action-manipulation" 
                    aria-label="Cerrar"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="flex-1 overflow-y-auto p-8 overscroll-contain">
                {@render children()}
            </div>
            {#if footer}
                <div class="flex justify-end gap-4 p-6 border-t border-ink-100 bg-ink-50">
                    {@render footer()}
                </div>
            {/if}
        </div>
    </div>
{/if}
