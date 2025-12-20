<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	for?: string;
	class?: string;
	children: Snippet;
};

let { for: htmlFor, class: className = "", children }: Props = $props();

const baseStyles = "block text-xs uppercase tracking-widest text-ink-400 mb-2 font-bold";
</script>

<label for={htmlFor} class="{baseStyles} {className}">
	{@render children()}
</label>
