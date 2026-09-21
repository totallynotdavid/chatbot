<script lang="ts">
import type { Conversation } from "@vendeya/types";
import ConversationItem from "./conversation-item.svelte";

type Props = {
  conversations: Conversation[];
};

let { conversations }: Props = $props();

/**
 * A conversation is identified by (tenant, channel account, phone number): the
 * same contact writing to two of the business's numbers is two threads. The
 * link carries the channel account so the detail page opens the right one
 * instead of whichever was active most recently.
 */
function conversationKey(conv: Conversation): string {
  return `${conv.channel_account_id}:${conv.phone_number}`;
}
</script>

<div class="w-full md:w-96 xl:w-96 border-r border-ink-900/10 bg-white flex flex-col shrink-0">
	<div class="p-6 border-b border-ink-900/10">
		<span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-1 block">
			Conversaciones activas
		</span>
    <h2 class="text-2xl font-serif">Bandeja de entrada</h2>
	</div>

	<div class="overflow-y-auto flex-1">
		{#each conversations as conv (conversationKey(conv))}
			<ConversationItem
				conversation={conv}
				href="/dashboard/conversations/{conv.phone_number}?channel={conv.channel_account_id}"
			/>
		{/each}

		{#if conversations.length === 0}
			<div class="p-12 text-center text-ink-300">
				<p class="font-serif italic">No hay conversaciones activas.</p>
			</div>
		{/if}
	</div>
</div>
