<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
	title: string;
	subtitle: string;
	actions?: Snippet;
};

let { title, subtitle, actions }: Props = $props();
</script>

<div class="flex flex-col md:flex-row justify-between items-end mb-8 border-b border-ink-900/10 pb-6 gap-6">
	<div>
		<span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-2 block">
			{subtitle}
		</span>
		<h1 class="text-4xl md:text-5xl font-serif text-ink-900 leading-tight">
			{title}
		</h1>
	</div>
	{#if actions}
		<div class="flex gap-4">
			{@render actions()}
		</div>
	{/if}
</div>
