<script lang="ts">
import type { Conversation } from "@totem/types";
import Button from "$lib/components/ui/button.svelte";
import { formatPhone, formatPrice } from "$lib/utils/formatters";
import { auth } from "$lib/state/auth.svelte";

type Props = {
    conversation: Conversation;
    phone: string;
    onTakeover: () => void;
    onLoadInSimulator?: () => void;
};

let { conversation, phone, onTakeover, onLoadInSimulator }: Props = $props();

const isHumanTakeover = $derived(conversation.status === "human_takeover");
</script>

<div class="p-6 border-b border-ink-900/10 bg-white/80 backdrop-blur flex justify-between items-center sticky top-0 z-10">
	<div>
		<h2 class="font-serif text-2xl">{formatPhone(phone)}</h2>
		<p class="text-xs text-ink-400 uppercase tracking-widest font-bold">
			{conversation.client_name || "Cliente"}
			{#if conversation.segment}
				<span class="ml-2">• {conversation.segment.toUpperCase()}</span>
			{/if}
			{#if conversation.credit_line}
				<span class="ml-2">• S/ {formatPrice(conversation.credit_line)}</span>
			{/if}
		</p>
	</div>

	<div class="flex items-center gap-3">
		{#if auth.canEdit && onLoadInSimulator}
			<Button variant="secondary" onclick={onLoadInSimulator} class="py-2 text-xs">
				Replay
			</Button>
		{/if}

		{#if !isHumanTakeover}
			<Button variant="secondary" onclick={onTakeover} class="py-2 text-xs">
				Intervenir
			</Button>
		{:else}
			<div class="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200">
				<span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
				<span class="text-xs font-bold text-red-800 uppercase tracking-wider">
					Humano activo
				</span>
			</div>
		{/if}
	</div>
</div>
