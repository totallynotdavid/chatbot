<script lang="ts">
import type { Conversation } from "@totem/types";
import { formatPhone } from "$lib/utils/formatters";

type Props = {
  conversation: Conversation;
  isSelected: boolean;
  onclick?: () => void;
  href?: string;
};

let { conversation, isSelected, onclick, href }: Props = $props();
</script>

{#if href}
<a
	{href}
	class="block w-full text-left px-6 py-4 border-b border-ink-900/5 hover:bg-white transition-all group relative {isSelected ? 'bg-white' : 'bg-transparent'}"
>
    {#if isSelected}
        <div class="absolute left-0 top-0 bottom-0 w-1 bg-ink-900"></div>
    {/if}

	<div class="flex justify-between items-baseline mb-1">
		<span class="font-serif text-base text-ink-900 {isSelected ? 'font-medium' : ''}">
			{formatPhone(conversation.phone_number)}
		</span>
        {#if conversation.status === "human_takeover"}
            <span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
        {/if}
	</div>

	<div class="text-xs font-sans text-ink-500 truncate mb-1 tracking-wide">
		{conversation.client_name || "Sin nombre"}
	</div>

    <div class="flex items-center gap-2">
        <span class="text-[10px] uppercase tracking-widest font-bold text-ink-300 group-hover:text-ink-400 transition-colors">
            {conversation.current_state}
        </span>
    </div>

	{#if conversation.handover_reason}
		<div class="text-[10px] text-red-600 mt-1 font-mono truncate">
			{conversation.handover_reason}
		</div>
	{/if}
</a>
{:else}
<button
	{onclick}
	class="w-full text-left px-6 py-4 border-b border-ink-900/5 hover:bg-white transition-all group relative {isSelected ? 'bg-white' : 'bg-transparent'}"
>
    {#if isSelected}
        <div class="absolute left-0 top-0 bottom-0 w-1 bg-ink-900"></div>
    {/if}

	<div class="flex justify-between items-baseline mb-1">
		<span class="font-serif text-base text-ink-900 {isSelected ? 'font-medium' : ''}">
			{formatPhone(conversation.phone_number)}
		</span>
        {#if conversation.status === "human_takeover"}
            <span class="w-1.5 h-1.5 bg-red-500 rounded-full"></span>
        {/if}
	</div>

	<div class="text-xs font-sans text-ink-500 truncate mb-1 tracking-wide">
		{conversation.client_name || "Sin nombre"}
	</div>

    <div class="flex items-center gap-2">
        <span class="text-[10px] uppercase tracking-widest font-bold text-ink-300 group-hover:text-ink-400 transition-colors">
            {conversation.current_state}
        </span>
    </div>

	{#if conversation.handover_reason}
		<div class="text-[10px] text-red-600 mt-1 font-mono truncate">
			{conversation.handover_reason}
		</div>
	{/if}
</button>
{/if}
