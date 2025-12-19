<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";

let testPhone = $state("51900000001");
let messages = $state<any[]>([]);
let currentInput = $state("");
let conversation = $state<any>(null);
let loading = $state(false);

async function loadConversation() {
    const res = await fetch(`/api/simulator/conversation/${testPhone}`);
    if (res.ok) {
        const data = await res.json();
        conversation = data.conversation;
        messages = data.messages;
    }
}

async function sendMessage() {
    if (!currentInput.trim()) return;

    loading = true;
    const messageText = currentInput;
    currentInput = "";

    // Optimistically add to UI
    messages = [
        ...messages,
        {
            id: Date.now().toString(),
            direction: "inbound",
            type: "text",
            content: messageText,
            created_at: new Date().toISOString(),
        },
    ];

    try {
        await fetch("/api/simulator/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phoneNumber: testPhone,
                message: messageText,
            }),
        });

        // Reload to get bot responses
        setTimeout(() => loadConversation(), 1000);
    } catch (error) {
        console.error("Send error:", error);
    } finally {
        loading = false;
    }
}

async function resetConversation() {
    if (!confirm("¿Reiniciar la conversación?")) return;

    await fetch(`/api/simulator/reset/${testPhone}`, { method: "POST" });
    messages = [];
    conversation = null;
    await loadConversation();
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

onMount(() => {
    if (!user.isAuthenticated) {
        window.location.href = "/login";
        return;
    }
    loadConversation();
});
</script>

<div class="page-container max-w-5xl">
  <div class="module-header">
    <div>
      <span class="module-subtitle">Entorno de pruebas</span>
      <h1 class="module-title">Simulador</h1>
    </div>
    <div class="flex gap-4">
      <div class="mb-0">
        <label for="test-phone" class="input-label">Número de prueba</label>
        <input id="test-phone" bind:value={testPhone} class="input-field text-sm font-mono" readonly />
      </div>
      <button onclick={resetConversation} class="btn-secondary self-end">
        Reiniciar
      </button>
    </div>
  </div>

  {#if conversation}
    <div class="bg-cream-200 p-4 mb-8 border-l-4 border-ink-900 font-mono text-sm">
      <div class="grid grid-cols-3 gap-4">
        <div>
          <span class="text-xs text-ink-400 uppercase">Estado</span>
          <div class="font-bold">{conversation.current_state}</div>
        </div>
        <div>
          <span class="text-xs text-ink-400 uppercase">Segmento</span>
          <div class="font-bold">{conversation.segment || "—"}</div>
        </div>
        <div>
          <span class="text-xs text-ink-400 uppercase">Crédito</span>
          <div class="font-bold">{conversation.credit_line ? `S/ ${conversation.credit_line}` : "—"}</div>
        </div>
      </div>
    </div>
  {/if}

  <div class="bg-white border border-cream-200 shadow-lg" style="height: 600px; display: flex; flex-direction: column;">
    <!-- Messages area -->
    <div class="flex-1 overflow-y-auto p-8 space-y-4">
      {#if messages.length === 0}
        <div class="h-full flex items-center justify-center text-ink-300">
          <p class="font-serif italic">Escribe un mensaje para iniciar la simulación...</p>
        </div>
      {/if}

      {#each messages as msg}
        <div class={`flex ${msg.direction === 'inbound' ? 'justify-end' : 'justify-start'}`}>
          <div class={`max-w-md ${msg.direction === 'inbound' ? 'bg-ink-900 text-white' : 'bg-cream-100 text-ink-900'} p-4 shadow-sm`}>
            {#if msg.type === 'image'}
              <img src={`/static/${msg.content}`} alt="Product" class="max-w-full h-auto mb-2" />
            {:else}
              <p class="font-serif leading-relaxed whitespace-pre-wrap">{msg.content}</p>
            {/if}
            <span class={`text-xs block mt-2 ${msg.direction === 'inbound' ? 'text-white/60' : 'text-ink-400'}`}>
              {new Date(msg.created_at).toLocaleTimeString()}
            </span>
          </div>
        </div>
      {/each}
    </div>

    <!-- Input area -->
    <div class="border-t border-cream-200 p-4 bg-cream-50">
      <div class="flex gap-4">
        <input 
          type="text"
          bind:value={currentInput}
          onkeydown={handleKeydown}
          placeholder="Escribe un mensaje..."
          disabled={loading}
          class="flex-1 bg-white p-3 border-b border-ink-900/30 font-serif focus:outline-none focus:border-ink-900"
        />
        <button 
          onclick={sendMessage} 
          disabled={loading || !currentInput.trim()}
          class="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? "Enviando..." : "Enviar"}
        </button>
      </div>
      <p class="text-xs text-ink-400 mt-2 font-mono">
        Enter para enviar • Shift+Enter para salto de línea
      </p>
    </div>
  </div>
</div>
