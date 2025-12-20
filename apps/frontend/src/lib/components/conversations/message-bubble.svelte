<script lang="ts">
import { formatTime } from "$lib/utils/formatters";

type Props = {
    direction: "inbound" | "outbound";
    type: "text" | "image";
    content: string;
    status?: string;
    createdAt: string;
};

let { direction, type, content, status, createdAt }: Props = $props();

const isInbound = $derived(direction === "inbound");
</script>

<div class="flex {isInbound ? 'justify-end' : 'justify-start'}">
	<div
		class="max-w-xl p-6 shadow-sm {isInbound ? 'bg-ink-900 text-white' : 'bg-white text-ink-900 border border-cream-200'}"
	>
		{#if type === "image"}
			<img
				src="/static/{content}"
				alt="Imagen"
				class="max-w-full h-auto mb-3 border border-cream-200"
			/>
		{:else}
			<p class="font-serif leading-relaxed whitespace-pre-wrap">
				{content}
			</p>
		{/if}
		<span class="text-xs block mt-3 {isInbound ? 'text-white/50' : 'text-ink-400'}">
			{formatTime(createdAt)}{#if status} • {status}{/if}
		</span>
	</div>
</div>
