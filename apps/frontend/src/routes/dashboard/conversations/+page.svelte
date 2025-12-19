<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";
import type { Conversation } from "@totem/types";

let conversations = $state<Conversation[]>([]);
let selectedPhone = $state<string | null>(null);
let messageText = $state("");
let conversationDetail = $state<any>(null);
let polling: Timer | null = null;

async function loadConversations() {
    const res = await fetch("/api/conversations");
    if (res.status === 401) {
        user.logout();
        return;
    }
    if (res.ok) {
        conversations = await res.json();
    }
}

async function loadConversationDetail(phone: string) {
    const res = await fetch(`/api/conversations/${phone}`);
    if (res.ok) {
        conversationDetail = await res.json();
    }
}

async function takeover(phone: string) {
    await fetch(`/api/conversations/${phone}/takeover`, { method: "POST" });
    await loadConversations();
    if (selectedPhone === phone) {
        await loadConversationDetail(phone);
    }
}

async function sendMessage() {
    if (!(selectedPhone && messageText.trim())) return;

    await fetch(`/api/conversations/${selectedPhone}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageText }),
    });

    messageText = "";
    await loadConversationDetail(selectedPhone);
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

$effect(() => {
    if (selectedPhone) {
        loadConversationDetail(selectedPhone);
    }
});

onMount(() => {
    if (!user.isAuthenticated) {
        window.location.href = "/login";
        return;
    }

    loadConversations();

    // Poll every 2 seconds
    polling = setInterval(() => {
        loadConversations();
        if (selectedPhone) {
            loadConversationDetail(selectedPhone);
        }
    }, 2000);

    return () => {
        if (polling) clearInterval(polling);
    };
});
</script>

<div class="flex h-[calc(100vh-80px)]">
  <!-- Conversation List -->
  <div class="w-full md:w-96 border-r border-ink-900/10 bg-white flex flex-col">
    <div class="p-6 border-b border-ink-900/10">
      <span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-1 block">Bandeja de entrada</span>
      <h2 class="text-2xl font-serif">Activos</h2>
    </div>
    <div class="overflow-y-auto flex-1">
      {#each conversations as conv}
        <button
          onclick={() => (selectedPhone = conv.phone_number)}
          class={`w-full text-left p-6 border-b border-cream-100 hover:bg-cream-50 transition-colors group ${
            selectedPhone === conv.phone_number
              ? "bg-cream-100 border-l-4 border-l-ink-900"
              : "border-l-4 border-l-transparent"
          }`}
        >
          <div class="flex justify-between items-center mb-2">
            <span class="font-mono text-sm font-semibold tracking-wide">
              +{conv.phone_number}
            </span>
            <span
              class={`text-[10px] px-2 py-0.5 border font-bold ${
                conv.status === "human_takeover"
                  ? "bg-red-600 text-white border-red-600"
                  : "text-ink-400 border-ink-200"
              }`}
            >
              {conv.status === "human_takeover" ? "MANUAL" : "AUTO"}
            </span>
          </div>

          <div class="text-sm font-serif text-ink-600 truncate opacity-80 group-hover:opacity-100 transition-opacity mb-1">
            {conv.client_name || "Sin nombre"} • {conv.current_state}
          </div>

          {#if conv.handover_reason}
            <div class="text-xs text-red-700 bg-red-50 px-2 py-1 mt-2 border-l-2 border-red-600">
              {conv.handover_reason}
            </div>
          {/if}
        </button>
      {/each}

      {#if conversations.length === 0}
        <div class="p-12 text-center text-ink-300">
          <p class="font-serif italic">No hay conversaciones activas.</p>
        </div>
      {/if}
    </div>
  </div>

  <!-- Detail View -->
  <div class="hidden md:flex flex-col flex-1 bg-cream-50 relative">
    {#if selectedPhone && conversationDetail}
      {@const conv = conversationDetail.conversation}
      {@const msgs = conversationDetail.messages}

      <div class="p-6 border-b border-ink-900/10 bg-white/80 backdrop-blur flex justify-between items-center sticky top-0 z-10">
        <div>
          <h2 class="font-serif text-2xl">+{selectedPhone}</h2>
          <p class="text-xs text-ink-400 uppercase tracking-widest font-bold">
            {conv.client_name || "Cliente"}
            {#if conv.segment}
              <span class="ml-2">• {conv.segment.toUpperCase()}</span>
            {/if}
            {#if conv.credit_line}
              <span class="ml-2">• S/ {conv.credit_line}</span>
            {/if}
          </p>
        </div>

        {#if conv.status !== "human_takeover"}
          <button
            onclick={() => takeover(selectedPhone!)}
            class="btn-secondary py-2 text-xs"
          >
            Intervenir
          </button>
        {:else}
          <div class="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200">
            <span class="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
            <span class="text-xs font-bold text-red-800 uppercase tracking-wider">
              Humano Activo
            </span>
          </div>
        {/if}
      </div>

      <!-- Messages -->
      <div class="flex-1 overflow-y-auto p-8 space-y-6">
        {#if msgs.length === 0}
          <div class="flex justify-center py-12">
            <span class="text-xs text-ink-300 uppercase tracking-widest border-b border-ink-200 pb-1">
              Inicio de conversación
            </span>
          </div>
        {/if}

        {#each msgs as msg}
          <div
            class={`flex ${msg.direction === "inbound" ? "justify-end" : "justify-start"}`}
          >
            <div
              class={`max-w-xl ${
                msg.direction === "inbound"
                  ? "bg-ink-900 text-white"
                  : "bg-white text-ink-900 border border-cream-200"
              } p-6 shadow-sm`}
            >
              {#if msg.type === "image"}
                <img
                  src={`/static/${msg.content}`}
                  alt="Imagen"
                  class="max-w-full h-auto mb-3 border border-cream-200"
                />
              {:else}
                <p class="font-serif leading-relaxed whitespace-pre-wrap">
                  {msg.content}
                </p>
              {/if}
              <span
                class={`text-xs block mt-3 ${
                  msg.direction === "inbound" ? "text-white/50" : "text-ink-400"
                }`}
              >
                {new Date(msg.created_at).toLocaleTimeString()} • {msg.status}
              </span>
            </div>
          </div>
        {/each}
      </div>

      <!-- Input (only if human takeover) -->
      {#if conv.status === "human_takeover"}
        <div class="p-6 border-t border-ink-900/10 bg-white">
          <div class="flex gap-4">
            <input
              bind:value={messageText}
              onkeydown={handleKeydown}
              class="flex-1 bg-white p-4 text-lg font-serif outline-none border-b border-ink-900/30 focus:border-ink-900 placeholder-ink-300"
              placeholder="Escriba su mensaje..."
            />
            <button
              onclick={sendMessage}
              disabled={!messageText.trim()}
              class="bg-ink-900 text-white px-8 font-bold hover:bg-ink-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ENVIAR
            </button>
          </div>
          <p class="text-xs text-ink-400 mt-2 font-mono">
            Enter para enviar • Shift+Enter para salto de línea
          </p>
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
