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

<div class="px-8 py-6 border-b border-ink-900/10 bg-white/95 backdrop-blur sticky top-0 z-10">
    <div class="flex justify-between items-start mb-6">
        <div>
            <h2 class="font-serif text-3xl text-ink-900 mb-1">
                {#if conversation.client_name}
                    <span class="text-ink-900">{conversation.client_name}</span>
                    <span class="text-ink-400 text-xl ml-3">{formatPhone(phone)}</span>
                {:else}
                    {formatPhone(phone)}
                {/if}
            </h2>
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
            {/if}
        </div>
    </div>

    <!-- Context Data Bar -->
    <div class="flex items-center gap-6 text-[10px] font-mono uppercase tracking-wider text-ink-500 border-t border-ink-900/5 pt-4">
        <div class="flex gap-2">
            <span class="text-ink-300">Segmento:</span>
            <span class="text-ink-900 font-bold">{conversation.segment || "—"}</span>
        </div>
        <div class="w-px h-3 bg-ink-200"></div>
        <div class="flex gap-2">
            <span class="text-ink-300">Crédito:</span>
            <span class="text-ink-900 font-bold">{conversation.credit_line ? `S/ ${formatPrice(conversation.credit_line)}` : "—"}</span>
        </div>
        <div class="w-px h-3 bg-ink-200"></div>
        <div class="flex gap-2">
            <span class="text-ink-300">Estado:</span>
            <span class="text-ink-900 font-bold">{conversation.current_state}</span>
        </div>
        <div class="w-px h-3 bg-ink-200"></div>
        <div class="flex gap-2 items-center">
            <span class="text-ink-300">Intervención:</span>
            {#if isHumanTakeover}
                <div class="flex items-center gap-1.5">
                    <span 
                        class="w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" 
                        title={conversation.handover_reason || "Intervención manual activa"}
                    ></span>
                    <span class="text-red-600 font-bold">Activa</span>
                </div>
            {:else}
                <span class="text-ink-900 font-bold">—</span>
            {/if}
        </div>
    </div>
</div>
