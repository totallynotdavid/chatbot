<script lang="ts">
import { formatTime } from "$lib/utils/formatters";
import type { Snippet } from "svelte";

type Props = {
  direction: "inbound" | "outbound";
  type: "text" | "image";
  content: string;
  status?: string;
  createdAt: string;
  actions?: Snippet;
};

let { direction, type, content, status, createdAt, actions }: Props = $props();

const isInbound = $derived(direction === "inbound");
</script>

<div class="flex {isInbound ? 'justify-end' : 'justify-start'} group">
	<div
		class="relative max-w-xl p-4 {isInbound ? 'bg-ink-900 text-cream-50' : 'bg-white text-ink-900 border border-ink-900/10'}"
	>
        {#if actions}
            <div class="absolute -top-3 -right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                {@render actions()}
            </div>
        {/if}
		{#if type === "image"}
			<img
				src="/static/{content}"
				alt="Imagen"
				class="max-w-full h-auto mb-4 border border-ink-900/10"
			/>
		{:else}
			<p class="font-serif text-base leading-relaxed whitespace-pre-wrap {isInbound ? 'text-cream-50' : 'text-ink-900'}">
				{content}
			</p>
		{/if}
		<span class="text-[10px] font-mono uppercase tracking-widest block mt-2 {isInbound ? 'text-cream-50/40' : 'text-ink-300'}">
			{formatTime(createdAt)}{#if status} • {status}{/if}
		</span>
	</div>
</div>
