<script lang="ts">
import { onMount } from "svelte";
import { auth } from "$lib/state/auth.svelte";
import { fetchApi } from "$lib/utils/api";
import PageHeader from "$lib/components/shared/page-header.svelte";
import Button from "$lib/components/ui/button.svelte";
import Input from "$lib/components/ui/input.svelte";
import MessageBubble from "$lib/components/conversations/message-bubble.svelte";

let testPhone = $state("51900000001");
let messages = $state<any[]>([]);
let currentInput = $state("");
let conversation = $state<any>(null);
let loading = $state(false);
let messagesContainer: HTMLDivElement;

async function loadConversation() {
	const data = await fetchApi<any>(`/api/simulator/conversation/${testPhone}`);
	conversation = data.conversation;
	messages = data.messages;
	setTimeout(scrollToBottom, 100);
}

function scrollToBottom() {
	if (messagesContainer) {
		messagesContainer.scrollTop = messagesContainer.scrollHeight;
	}
}

async function sendMessage() {
	if (!currentInput.trim()) return;

	loading = true;
	const messageText = currentInput;
	currentInput = "";

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

	setTimeout(scrollToBottom, 50);

	try {
		await fetchApi("/api/simulator/message", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ phoneNumber: testPhone, message: messageText }),
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
	await loadConversation();
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		sendMessage();
	}
}

onMount(() => {
	if (!auth.isAuthenticated) {
		window.location.href = "/login";
		return;
	}
	loadConversation();
});
</script>

<div class="max-w-5xl mx-auto p-8 md:p-12 min-h-screen">
	<PageHeader title="Simulador" subtitle="Entorno de pruebas">
		{#snippet actions()}
			<div class="mb-0">
				<label for="test-phone" class="block text-xs uppercase tracking-widest text-ink-400 mb-2 font-bold">
					Número de prueba
				</label>
				<Input
					id="test-phone"
					bind:value={testPhone}
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

			{#each messages as msg (msg.id)}
				<MessageBubble
					direction={msg.direction}
					type={msg.type}
					content={msg.content}
					createdAt={msg.created_at}
				/>
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
				<Button onclick={sendMessage} disabled={loading || !currentInput.trim()}>
					{loading ? "Enviando..." : "Enviar"}
				</Button>
			</div>
			<p class="text-xs text-ink-400 mt-2 font-mono">
				Enter para enviar • Shift+Enter para salto de línea
			</p>
		</div>
	</div>
</div>
