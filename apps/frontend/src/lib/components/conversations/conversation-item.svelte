<script lang="ts">
import type { Conversation } from "@totem/types";
import { formatPhone } from "$lib/utils/formatters";

type Props = {
	conversation: Conversation;
	isSelected: boolean;
	onclick: () => void;
};

let { conversation, isSelected, onclick }: Props = $props();
</script>

<button
	{onclick}
	class="w-full text-left p-6 border-b border-cream-100 hover:bg-cream-50 transition-colors group border-l-4 {isSelected ? 'bg-cream-100 border-l-ink-900' : 'border-l-transparent'}"
>
	<div class="flex justify-between items-center mb-2">
		<span class="font-mono text-sm font-semibold tracking-wide">
			{formatPhone(conversation.phone_number)}
		</span>
		<span
			class="text-[10px] px-2 py-0.5 border font-bold {conversation.status === 'human_takeover' ? 'bg-red-600 text-white border-red-600' : 'text-ink-400 border-ink-200'}"
		>
			{conversation.status === "human_takeover" ? "MANUAL" : "AUTO"}
		</span>
	</div>

	<div class="text-sm font-serif text-ink-600 truncate opacity-80 group-hover:opacity-100 transition-opacity mb-1">
		{conversation.client_name || "Sin nombre"} • {conversation.current_state}
	</div>

	{#if conversation.handover_reason}
		<div class="text-xs text-red-700 bg-red-50 px-2 py-1 mt-2 border-l-2 border-red-600">
			{conversation.handover_reason}
		</div>
	{/if}
</button>
