<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	onclick?: () => void;
	disabled?: boolean;
	open?: boolean;
	class?: string;
	children: Snippet;
};

let { onclick, disabled = false, open = false, class: className = "", children }: Props = $props();
</script>

<button
	type="button"
	{disabled}
	{onclick}
	aria-haspopup="true"
	aria-expanded={open}
	class="{className} min-h-[40px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 touch-action-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
>
	{@render children()}
</button>
