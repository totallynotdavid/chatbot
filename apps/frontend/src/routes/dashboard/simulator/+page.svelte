<script lang="ts">
import { onMount } from "svelte";
import { fetchApi } from "$lib/utils/api";
import { formatPhone, formatPrice } from "$lib/utils/formatters";
import Button from "$lib/components/ui/button.svelte";
import Badge from "$lib/components/ui/badge.svelte";
import MessageBubble from "$lib/components/conversations/message-bubble.svelte";
import ConversationItem from "$lib/components/conversations/conversation-item.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { ReplayData, Conversation } from "@totem/types";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let testConversations = $state<Conversation[]>([]);
let selectedPhone = $state<string | null>(null);
let messages = $state<any[]>([]);
let currentInput = $state("");
let conversation = $state<any>(null);
let loading = $state(false);
let messagesContainer = $state<HTMLDivElement>();
let polling: Timer | null = null;

// Replay mode state
let replayMode = $state(false);
let replayMetadata = $state<any>(null);
let editingMessageIndex = $state<number | null>(null);
let editedContent = $state("");

async function loadTestConversations() {
    testConversations = await fetchApi<Conversation[]>("/api/simulator/conversations");
}

async function loadConversation(phone: string) {
    const data = await fetchApi<any>(`/api/simulator/conversation/${phone}`);
    conversation = data.conversation;
    messages = data.messages;
    setTimeout(scrollToBottom, 100);
}

function scrollToBottom() {
    if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
}

async function createNewConversation() {
    loading = true;
    try {
        // Auto-generate phone number based on existing count
        const phoneNumber = `519${String(testConversations.length + 1).padStart(8, '0')}`;
        
        await fetchApi("/api/simulator/conversations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ phoneNumber }),
        });
        
        await loadTestConversations();
        selectedPhone = phoneNumber;
    } catch (error) {
        console.error("Failed to create conversation:", error);
        alert("Error al crear simulación");
    } finally {
        loading = false;
    }
}

async function deleteConversation(phone: string) {
    if (!confirm("¿Eliminar esta simulación?")) return;
    
    loading = true;
    try {
        await fetchApi(`/api/simulator/conversations/${phone}`, { method: "DELETE" });
        
        if (selectedPhone === phone) {
            selectedPhone = null;
            messages = [];
            conversation = null;
        }
        
        await loadTestConversations();
    } catch (error) {
        console.error("Failed to delete conversation:", error);
        alert("Error al eliminar simulación");
    } finally {
        loading = false;
    }
}

async function sendMessage(messageText?: string) {
    if (!selectedPhone) return;
    
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
                phoneNumber: selectedPhone,
                message: textToSend,
            }),
        });

        if (selectedPhone) {
            setTimeout(() => loadConversation(selectedPhone!), 1000);
        }
    } catch (error) {
        console.error("Send error:", error);
    } finally {
        loading = false;
    }
}

async function resetConversation() {
    if (!selectedPhone) return;
    if (!confirm("¿Reiniciar la conversación?")) return;

    await fetchApi(`/api/simulator/reset/${selectedPhone}`, { method: "POST" });
    messages = [];
    conversation = null;
    replayMode = false;
    replayMetadata = null;
    await loadConversation(selectedPhone);
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

        // Set to fixed test phone and reload
        selectedPhone = "51900000001";
        await loadTestConversations();
        await loadConversation(selectedPhone);
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
    if (!selectedPhone) return;
    
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
        await fetchApi(`/api/simulator/reset/${selectedPhone}`, { method: "POST" });

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
                        phoneNumber: selectedPhone,
                        message: content,
                    }),
                });

                // Wait between messages to ensure proper processing
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Reload conversation to see new state
        await loadConversation(selectedPhone);
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

$effect(() => {
    if (selectedPhone) {
        loadConversation(selectedPhone);
    }
});

onMount(() => {
    // Check if we should load a replay conversation (from server data)
    if (data.loadPhone) {
        loadReplayConversation(data.loadPhone);
    } else {
        loadTestConversations().then(() => {
            // Select first conversation if available
            if (testConversations.length > 0 && !selectedPhone) {
                selectedPhone = testConversations[0]?.phone_number ?? null;
            }
        });
    }

    polling = setInterval(() => {
        loadTestConversations();
        if (selectedPhone) loadConversation(selectedPhone);
    }, 2000);

    return () => {
        if (polling) clearInterval(polling);
    };
});
</script>

<PageTitle title="Simulador" />

<div class="flex h-[calc(100vh-65px)] overflow-hidden bg-white">
	<!-- Conversation List -->
	<div class="w-full md:w-80 xl:w-96 border-r border-ink-900/10 bg-white flex flex-col shrink-0">
		<div class="p-6 border-b border-ink-900/10 flex items-center justify-between">
			<div>
				<span class="text-xs font-bold tracking-widest uppercase text-ink-400 mb-1 block">
					Conversaciones de prueba
				</span>
				<h2 class="text-2xl font-serif">Simulador</h2>
			</div>
			<button
				onclick={createNewConversation}
				disabled={loading}
				class="w-8 h-8 flex items-center justify-center text-ink-900 hover:bg-ink-50 rounded-full transition-colors disabled:opacity-50"
				title="Nueva simulación"
			>
				<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19"></line>
					<line x1="5" y1="12" x2="19" y2="12"></line>
				</svg>
			</button>
		</div>

		<div class="overflow-y-auto flex-1">
			{#each testConversations as conv (conv.phone_number)}
				<ConversationItem
					conversation={conv}
					isSelected={selectedPhone === conv.phone_number}
					onclick={() => selectedPhone = conv.phone_number}
				/>
			{/each}

			{#if testConversations.length === 0}
				<div class="p-12 text-center text-ink-300">
					<p class="font-serif italic">No hay conversaciones de prueba.</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Conversation Detail -->
	<div class="hidden md:flex flex-col flex-1 bg-cream-100 relative min-w-0">
		{#if selectedPhone && conversation}
			<!-- Header -->
			<div class="px-8 py-6 border-b border-ink-900/10 bg-white/95 backdrop-blur sticky top-0 z-10">
				<div class="flex justify-between items-center">
					<div class="space-y-[1px]">
						<div class="flex items-center gap-3">
							<h2 class="font-serif text-3xl text-ink-900">
								{#if conversation.client_name}
									<span class="text-ink-900">{conversation.client_name}</span>
									<span class="text-ink-400 text-xl ml-3">{formatPhone(selectedPhone)}</span>
								{:else}
									{formatPhone(selectedPhone)}
								{/if}
							</h2>
							{#if replayMode && replayMetadata}
								<Badge variant="warning" class="text-xs">
									DEPURACIÓN: {replayMetadata.conversationId} • {replayMetadata.finalState}
								</Badge>
							{/if}
						</div>

						<!-- Context Data Bar -->
						<div class="flex items-center gap-4 text-[10px] font-mono uppercase tracking-wider text-ink-500">
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
								{#if conversation.status === "human_takeover"}
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

					<div class="flex items-center gap-3">
						{#if replayMode}
							<Button variant="secondary" onclick={exitReplayMode} class="text-xs py-2">
								Salir de depuración
							</Button>
						{:else}
							<Button variant="secondary" onclick={resetConversation} class="text-xs py-2">
								Reiniciar
							</Button>
							<Button variant="secondary" onclick={() => deleteConversation(selectedPhone!)} class="text-xs py-2">
								Eliminar
							</Button>
						{/if}
					</div>
				</div>
			</div>

			<!-- Messages -->
			<div
				bind:this={messagesContainer}
				class="flex-1 overflow-y-auto p-8 space-y-4"
			>
				{#if messages.length === 0}
					<div class="h-full flex items-center justify-center text-ink-300">
						<p class="font-serif italic">Escribe un mensaje para iniciar la simulación...</p>
					</div>
				{/if}

				{#each messages as msg, i (msg.id)}
					<div class="space-y-2">
						{#if editingMessageIndex === i}
							<div class="bg-amber-50 border border-amber-200 rounded-lg p-4 shadow-sm ml-auto max-w-xl">
								<div class="flex justify-between items-center mb-2">
									<span class="text-xs font-bold text-amber-800 uppercase tracking-wider">Editando mensaje</span>
									<button onclick={cancelEditing} class="text-amber-800 hover:text-amber-900" aria-label="Cancelar edición">
										<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<line x1="18" y1="6" x2="6" y2="18"></line>
											<line x1="6" y1="6" x2="18" y2="18"></line>
										</svg>
									</button>
								</div>
								<textarea
									bind:value={editedContent}
									class="w-full p-3 border border-amber-300 rounded bg-white font-serif focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 mb-3 text-ink-900"
									rows="3"
									placeholder="Editar mensaje..."
								></textarea>
								<div class="flex justify-end gap-2">
									<Button variant="secondary" onclick={cancelEditing} disabled={loading} class="text-xs">
										Cancelar
									</Button>
									<Button onclick={() => applyEdit(i)} disabled={loading} class="text-xs">
										{#if loading}
											<svg class="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
												<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
											</svg>
											Aplicando...
										{:else}
											Guardar y re-ejecutar
										{/if}
									</Button>
								</div>
							</div>
						{:else}
							<MessageBubble
								direction={msg.direction}
								type={msg.type}
								content={msg.content}
								createdAt={msg.created_at}
							>
								{#snippet actions()}
									{#if replayMode && msg.direction === "inbound"}
										<button
											onclick={() => startEditing(i)}
											class="bg-white text-ink-600 hover:text-blue-600 p-1.5 rounded-full shadow-sm border border-cream-200 hover:border-blue-200 transition-colors"
											title="Editar mensaje"
											disabled={loading}
										>
											<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
												<path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
											</svg>
										</button>
									{/if}
								{/snippet}
							</MessageBubble>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Input -->
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
					<Button onclick={() => sendMessage()} disabled={loading || !currentInput.trim()} class="px-4">
						{#if loading}
							<svg class="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
								<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
								<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
							</svg>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<line x1="22" y1="2" x2="11" y2="13"></line>
								<polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
							</svg>
						{/if}
					</Button>
				</div>
				<p class="text-xs text-ink-400 mt-2 font-mono">
					Enter para enviar • Shift+Enter para salto de línea
				</p>
			</div>
		{:else}
			<div class="flex-1 flex flex-col items-center justify-center text-ink-300 opacity-50">
				<span class="text-9xl mb-4 font-serif italic">&larr;</span>
				<p class="font-serif text-lg">Seleccione una conversación de prueba.</p>
			</div>
		{/if}
	</div>
</div>
