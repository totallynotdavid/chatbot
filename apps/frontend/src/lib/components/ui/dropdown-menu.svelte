<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	open?: boolean;
	class?: string;
	children: Snippet;
};

let { open = false, class: className = "", children }: Props = $props();

let selectedIndex = $state<number>(-1);

function handleKeydown(e: KeyboardEvent) {
	const items = Array.from(
		document.querySelectorAll<HTMLButtonElement>("[data-dropdown-item]")
	).filter(item => !item.disabled);

	if (items.length === 0) return;

	if (e.key === "ArrowDown") {
		e.preventDefault();
		selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
		items[selectedIndex]?.focus();
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		selectedIndex = Math.max(selectedIndex - 1, 0);
		items[selectedIndex]?.focus();
	}
}
</script>

{#if open}
	<div
		class={className}
		onkeydown={handleKeydown}
		role="menu"
		tabindex="-1"
	>
		{@render children()}
	</div>
{/if}
