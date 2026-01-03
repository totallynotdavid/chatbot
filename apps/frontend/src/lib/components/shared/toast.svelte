<script lang="ts">
import { fly } from "svelte/transition";
import { cubicOut } from "svelte/easing";

type Props = {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  onDismiss: (id: string) => void;
};

let { id, message, type, onDismiss }: Props = $props();

const icons = {
  success: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
};

const colors = {
  success: "text-green-600",
  error: "text-red-600",
  info: "text-ink-400",
};
</script>

<div
	transition:fly={{ y: 20, duration: 400, easing: cubicOut }}
	class="flex items-center justify-between gap-4 px-5 py-3 bg-white border border-ink-100 rounded-full shadow-lg min-w-75 max-w-112.5"
>
	<div class="flex items-center gap-3">
		<div class={colors[type]}>
			{@html icons[type]}
		</div>
		<span class="text-sm font-medium text-ink-900">{message}</span>
	</div>
	<button
		onclick={() => onDismiss(id)}
		class="text-ink-300 hover:text-ink-900 hover:bg-ink-50 p-1 rounded-full transition-colors"
		aria-label="Cerrar"
	>
		<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
			<line x1="18" y1="6" x2="6" y2="18"/>
			<line x1="6" y1="6" x2="18" y2="18"/>
		</svg>
	</button>
</div>
