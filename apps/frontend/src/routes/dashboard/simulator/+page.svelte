<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "$lib/utils/api";
import { formatPhone } from "$lib/utils/formatters";
import PageHeader from "$lib/components/shared/page-header.svelte";
import Button from "$lib/components/ui/button.svelte";
import Input from "$lib/components/ui/input.svelte";
import MessageBubble from "$lib/components/conversations/message-bubble.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { ReplayData } from "@totem/types";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let testPhone = $state("51900000001");
let messages = $state<any[]>([]);
let currentInput = $state("");
let conversation = $state<any>(null);
let loading = $state(false);
let messagesContainer: HTMLDivElement;

// Replay mode state
let replayMode = $state(false);
let replayMetadata = $state<any>(null);
let editingMessageIndex = $state<number | null>(null);
let editedContent = $state("");

async function loadConversation() {
    const data = await fetchApi<any>(
        `/api/simulator/conversation/${testPhone}`,
    );
    conversation = data.conversation;
    messages = data.messages;
    setTimeout(scrollToBottom, 100);
}

function scrollToBottom() {
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

async function sendMessage(messageText?: string) {
    const textToSend = messageText || currentInput.trim();
    if (!textToSend) return;

    loading = true;
    if (!messageText) currentInput = "";

    messages = [
        ...messages,
        {
            id: Date.now().toString(),
            direction: "inbound",
            type: "text",
            content: textToSend,
            created_at: new Date().toISOString(),
        },
    ];

    setTimeout(scrollToBottom, 50);

    try {
        await fetchApi("/api/simulator/message", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                phoneNumber: testPhone,
                message: textToSend,
            }),
        });

        setTimeout(() => loadConversation(), 1000);
    } catch (error) {
        console.error("Send error:", error);
    } finally {
        loading = false;
    }
}

async function resetConversation() {
    if (!confirm("¿Reiniciar la conversación?")) return;

    await fetchApi(`/api/simulator/reset/${testPhone}`, { method: "POST" });
    messages = [];
    conversation = null;
    replayMode = false;
    replayMetadata = null;
    await loadConversation();
}

async function loadReplayConversation(sourcePhone: string) {
    try {
        // Fetch replay data
        const replayData = await fetchApi<ReplayData>(
            `/api/conversations/${sourcePhone}/replay`
        );

        replayMode = true;
        replayMetadata = replayData.metadata;

        // Load into simulator backend
        await fetchApi("/api/simulator/load", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ sourcePhone }),
        });

        // Reload conversation
        await loadConversation();
    } catch (error) {
        console.error("Failed to load replay:", error);
        alert("No se pudo cargar la conversación");
    }
}

function startEditing(index: number) {
    const msg = messages[index];
    if (msg.direction !== "inbound") return;
    
    editingMessageIndex = index;
    editedContent = msg.content;
}

function cancelEditing() {
    editingMessageIndex = null;
    editedContent = "";
}

async function applyEdit(index: number) {
    const originalMsg = messages[index];
    const newContent = editedContent.trim();

    if (!newContent) {
        cancelEditing();
        return;
    }

    if (newContent === originalMsg.content) {
        cancelEditing();
        return;
    }

    // Count messages after edit point
    const futureMessagesCount = messages.length - index - 1;
    
    if (futureMessagesCount > 0) {
        const confirmed = confirm(
            `Editar este mensaje descartará los ${futureMessagesCount} mensajes siguientes. ¿Continuar?`
        );
        if (!confirmed) {
            cancelEditing();
            return;
        }
    }

    loading = true;
    cancelEditing();

    try {
        // Reset conversation
        await fetchApi(`/api/simulator/reset/${testPhone}`, { method: "POST" });

        // Replay messages up to and including edit point
        for (let i = 0; i <= index; i++) {
            const msg = messages[i];
            if (msg.direction === "inbound") {
                const content = i === index ? newContent : msg.content;
                
                // Send and wait for response
                await fetchApi("/api/simulator/message", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        phoneNumber: testPhone,
                        message: content,
                    }),
                });

                // Wait between messages to ensure proper processing
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Reload conversation to see new state
        await loadConversation();
    } catch (error) {
        console.error("Failed to apply edit:", error);
        alert("Error al aplicar la edición");
    } finally {
        loading = false;
    }
}

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function exitReplayMode() {
    replayMode = false;
    replayMetadata = null;
    resetConversation();
}

onMount(() => {
    // Check if we should load a replay conversation (from server data)
    if (data.loadPhone) {
        loadReplayConversation(data.loadPhone);
    } else {
        loadConversation();
    }
});
</script>

<PageTitle title="Simulador" />

<div class="max-w-5xl mx-auto p-8 md:p-12 min-h-screen">
	{#if replayMode && replayMetadata}
		<div class="bg-amber-50 border-l-4 border-amber-500 p-4 mb-6">
			<div class="flex items-start justify-between">
				<div>
					<h3 class="font-bold text-amber-900 mb-1">🔄 Modo Depuración</h3>
					<p class="text-sm text-amber-800">
						Conversación: <span class="font-mono">{formatPhone(replayMetadata.conversationId)}</span>
						{#if replayMetadata.clientName}
							• {replayMetadata.clientName}
						{/if}
						{#if replayMetadata.segment}
							• {replayMetadata.segment.toUpperCase()}
						{/if}
						{#if replayMetadata.creditLine}
							• S/ {replayMetadata.creditLine}
						{/if}
						• Estado final: {replayMetadata.finalState}
					</p>
				</div>
				<Button variant="secondary" onclick={exitReplayMode} class="text-xs py-1">
					Salir
				</Button>
			</div>
		</div>
	{/if}

	<PageHeader title="Simulador" subtitle={replayMode ? "Depurando conversación" : "Entorno de pruebas"}>
		{#snippet actions()}
			<div class="mb-0">
				<label for="test-phone" class="block text-xs uppercase tracking-widest text-ink-400 mb-2 font-bold">
					Número de prueba
				</label>
				<Input
					id="test-phone"
					value={formatPhone(testPhone)}
					class="text-sm font-mono py-1!"
					disabled
				/>
			</div>
			<Button variant="secondary" onclick={resetConversation} class="self-end">
				Reiniciar
			</Button>
		{/snippet}
	</PageHeader>

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
					<div class="font-bold">
						{conversation.credit_line ? `S/ ${conversation.credit_line}` : "—"}
					</div>
				</div>
			</div>
		</div>
	{/if}

	<div
		bind:this={messagesContainer}
		class="bg-white border border-cream-200 shadow-lg flex flex-col"
		style="height: 600px;"
	>
		<div class="flex-1 overflow-y-auto p-8 space-y-4">
			{#if messages.length === 0}
				<div class="h-full flex items-center justify-center text-ink-300">
					<p class="font-serif italic">Escribe un mensaje para iniciar la simulación...</p>
				</div>
			{/if}

			{#each messages as msg, i (msg.id)}
				<div class="space-y-2">
					{#if replayMode && msg.direction === "inbound"}
						<div class="flex items-center gap-2 mb-1">
							<span class="text-xs text-ink-400 font-mono">Mensaje {i + 1}/{messages.length}</span>
							{#if editingMessageIndex !== i}
								<button
									onclick={() => startEditing(i)}
									class="text-xs text-blue-600 hover:text-blue-800 font-medium"
									disabled={loading}
								>
									✏️ Editar
								</button>
							{/if}
						</div>
					{/if}

					{#if editingMessageIndex === i}
						<div class="bg-amber-50 border-2 border-amber-400 rounded-lg p-4">
							<textarea
								bind:value={editedContent}
								class="w-full p-2 border border-ink-900/30 font-serif focus:outline-none focus:border-ink-900 mb-3"
								rows="2"
								placeholder="Editar mensaje..."
							></textarea>
							<div class="flex gap-2">
								<Button onclick={() => applyEdit(i)} disabled={loading} class="text-xs py-1">
									{loading ? "Aplicando..." : "Re-ejecutar desde aquí"}
								</Button>
								<Button variant="secondary" onclick={cancelEditing} disabled={loading} class="text-xs py-1">
									Cancelar
								</Button>
							</div>
						</div>
					{:else}
						<MessageBubble
							direction={msg.direction}
							type={msg.type}
							content={msg.content}
							createdAt={msg.created_at}
						/>
					{/if}
				</div>
			{/each}
		</div>

		<div class="border-t border-cream-200 p-4 bg-cream-50">
			<div class="flex gap-4">
				<input
					type="text"
					bind:value={currentInput}
					onkeydown={handleKeydown}
					disabled={loading}
					placeholder="Escribe un mensaje..."
					class="flex-1 bg-white p-3 border-b border-ink-900/30 font-serif focus:outline-none focus:border-ink-900"
				/>
				<Button onclick={() => sendMessage()} disabled={loading || !currentInput.trim()}>
					{loading ? "Enviando..." : "Enviar"}
				</Button>
			</div>
			<p class="text-xs text-ink-400 mt-2 font-mono">
				Enter para enviar • Shift+Enter para salto de línea
			</p>
		</div>
	</div>
</div>
