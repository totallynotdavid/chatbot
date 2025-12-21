<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	onclick?: () => void;
	disabled?: boolean;
	class?: string;
	children: Snippet;
};

let { onclick, disabled = false, class: className = "", children }: Props = $props();
</script>

<button
	type="button"
	data-dropdown-item
	{disabled}
	{onclick}
	class="{className} min-h-[40px] w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1 touch-action-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
	role="menuitem"
	tabindex={disabled ? -1 : 0}
>
	{@render children()}
</button>
