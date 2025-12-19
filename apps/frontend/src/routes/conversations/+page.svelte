<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";
import type { Conversation } from "@totem/types";

let conversations = $state<Conversation[]>([]);
let selectedPhone = $state<string | null>(null);
let messageText = $state("");

async function load() {
    const res = await fetch("/api/conversations");
    if (res.status === 401) user.logout();
    else conversations = await res.json();
}

async function takeover(phone: string) {
    await fetch(`/api/conversations/${phone}/takeover`, { method: "POST" });
    load();
}

async function sendMessage() {
    if (!selectedPhone || !messageText) return;
    await fetch(`/api/conversations/${selectedPhone}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageText }),
    });
    messageText = "";
}

onMount(load);
</script>

<div class="flex h-[calc(100vh-80px)]">
    <div class="w-full md:w-96 border-r border-ink-900/10 bg-white flex flex-col">
        <div class="p-6 border-b border-ink-900/10">
             <span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-1 block">Bandeja de entrada</span>
            <h2 class="text-2xl font-serif">Activos</h2>
        </div>
        <div class="overflow-y-auto flex-1">
            {#each conversations as conv}
                <button 
                    onclick={() => selectedPhone = conv.phone_number} 
                    class="w-full text-left p-6 border-b border-cream-100 hover:bg-cream-50 transition-colors group {selectedPhone === conv.phone_number ? 'bg-cream-100 border-l-4 border-l-ink-900' : 'border-l-4 border-l-transparent'}"
                >
                    <div class="flex justify-between items-center mb-1">
                        <span class="font-mono text-sm font-semibold tracking-tight">{conv.phone_number}</span>
                        <span class="text-[10px] px-2 py-0.5 border {conv.status === 'human_takeover' ? 'bg-ink-900 text-white border-ink-900' : 'text-ink-400 border-ink-200'}">
                            {conv.status === 'human_takeover' ? 'MANUAL' : 'AUTO'}
                        </span>
                    </div>
                    <div class="text-sm font-serif text-ink-600 truncate opacity-80 group-hover:opacity-100 transition-opacity">
                        {conv.current_state}
                    </div>
                </button>
            {/each}
        </div>
    </div>

    <div class="hidden md:flex flex-col flex-1 bg-cream-50 relative">
        {#if selectedPhone}
            {@const activeConv = conversations.find(c => c.phone_number === selectedPhone)}
            
            <div class="p-6 border-b border-ink-900/10 bg-white/80 backdrop-blur flex justify-between items-center sticky top-0 z-10">
                <div>
                    <h2 class="font-serif text-2xl">{selectedPhone}</h2>
                    <p class="text-xs text-ink-400 uppercase tracking-widest font-bold">Sesión en curso</p>
                </div>
                
                {#if activeConv?.status !== 'human_takeover'}
                    <button onclick={() => takeover(selectedPhone!)} class="btn-secondary py-2 text-xs">
                        Intervenir
                    </button>
                {:else}
                    <div class="flex items-center gap-2 px-4 py-2 bg-cream-100 border border-cream-200">
                        <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                        <span class="text-xs font-bold text-ink-900 uppercase tracking-wider">Humano Activo</span>
                    </div>
                {/if}
            </div>

            <div class="grow p-12 overflow-y-auto space-y-6">
                <div class="flex justify-center mb-8">
                    <span class="text-xs text-ink-300 uppercase tracking-widest border-b border-ink-200 pb-1">Inicio de historial</span>
                </div>
                
                <div class="flex justify-start max-w-2xl">
                    <div class="bg-white border border-cream-200 p-6 shadow-sm">
                        <p class="text-base font-serif leading-relaxed text-ink-600">
                            El historial de mensajes se carga bajo demanda. Los nuevos mensajes aparecerán aquí en tiempo real.
                        </p>
                    </div>
                </div>
            </div>

            {#if activeConv?.status === 'human_takeover'}
                <div class="p-6 border-t border-ink-900/10 bg-white">
                    <div class="flex gap-0 shadow-lg">
                        <input 
                            bind:value={messageText} 
                            class="grow bg-white p-4 text-lg font-serif outline-none placeholder-ink-300"
                            placeholder="Escriba su mensaje..."
                        />
                        <button onclick={sendMessage} class="bg-ink-900 text-white px-8 font-bold hover:bg-ink-700 transition-colors">
                            ENVIAR
                        </button>
                    </div>
                </div>
            {/if}
        {:else}
            <div class="flex-1 flex flex-col items-center justify-center text-ink-300 opacity-50">
                <span class="text-9xl mb-4 font-serif italic">&larr;</span>
                <p class="font-serif text-lg">Seleccione un cliente.</p>
            </div>
        {/if}
    </div>
</div>
