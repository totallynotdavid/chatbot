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

let {
	open,
	title,
	subtitle,
	onClose,
	children,
	footer,
}: Props = $props();

function handleBackdropClick(e: MouseEvent) {
	if (e.target === e.currentTarget) onClose();
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Escape") onClose();
}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex items-center justify-center p-8"
		onclick={handleBackdropClick}
		onkeydown={handleKeydown}
	>
		<div class="bg-white border border-ink-200 shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col animate-in fade-in slide-in-from-bottom-4 duration-300">
			<div class="flex justify-between items-start p-8 border-b border-ink-100">
				<div>
					{#if subtitle}
						<span class="block text-[11px] font-bold uppercase tracking-wider text-ink-400 mb-2">{subtitle}</span>
					{/if}
					{#if title}
						<h2 class="text-3xl font-serif text-ink-900">{title}</h2>
					{/if}
				</div>
				<button
					onclick={onClose}
					class="text-ink-400 hover:text-ink-900 hover:bg-ink-50 p-2 rounded-full transition-colors -mt-2 -mr-2"
					aria-label="Cerrar"
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<line x1="18" y1="6" x2="6" y2="18"/>
						<line x1="6" y1="6" x2="18" y2="18"/>
					</svg>
				</button>
			</div>
			<div class="flex-1 overflow-y-auto p-8">
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
