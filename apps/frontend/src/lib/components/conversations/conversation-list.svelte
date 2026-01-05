<script lang="ts">
import type { Conversation } from "@totem/types";
import ConversationItem from "./conversation-item.svelte";

type Props = {
  conversations: Conversation[];
  selectedPhone: string | null;
};

let { conversations, selectedPhone }: Props = $props();
</script>

<div class="w-full md:w-96 xl:w-96 border-r border-ink-900/10 bg-white flex flex-col shrink-0">
	<div class="p-6 border-b border-ink-900/10">
		<span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-1 block">
			Conversaciones activas
		</span>
    <h2 class="text-2xl font-serif">Bandeja de entrada</h2>
	</div>

	<div class="overflow-y-auto flex-1">
		{#each conversations as conv (conv.phone_number)}
			<ConversationItem
				conversation={conv}
				isSelected={selectedPhone === conv.phone_number}
				href="/dashboard/conversations/{conv.phone_number}"
			/>
		{/each}

		{#if conversations.length === 0}
			<div class="p-12 text-center text-ink-300">
				<p class="font-serif italic">No hay conversaciones activas.</p>
			</div>
		{/if}
	</div>
</div>
