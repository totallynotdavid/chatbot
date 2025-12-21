<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	children: Snippet;
};

let { open = $bindable(false), onOpenChange, children }: Props = $props();

// Close on ESC
$effect(() => {
	if (!open) return;

	const handleKeydown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.preventDefault();
			open = false;
			onOpenChange?.(false);
		}
	};

	document.addEventListener("keydown", handleKeydown);
	return () => document.removeEventListener("keydown", handleKeydown);
});

// Close on click outside or on dropdown item click
$effect(() => {
	if (!open) return;

	const handleClick = (e: MouseEvent) => {
		const dropdown = document.querySelector("[data-dropdown]");
		if (!dropdown) return;

		const target = e.target as Node;
		
		// Close if clicking outside
		if (!dropdown.contains(target)) {
			open = false;
			onOpenChange?.(false);
			return;
		}

		// Close if clicking a dropdown item (not disabled)
		if (target instanceof HTMLElement) {
			const item = target.closest("[data-dropdown-item]");
			if (item && item instanceof HTMLButtonElement && !item.disabled) {
				// Use setTimeout to allow onclick to fire first
				setTimeout(() => {
					open = false;
					onOpenChange?.(false);
				}, 0);
			}
		}
	};

	document.addEventListener("click", handleClick);
	return () => document.removeEventListener("click", handleClick);
});
</script>

<div data-dropdown class="relative inline-block">
	{@render children()}
</div>
