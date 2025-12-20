<script lang="ts">
import { onMount } from "svelte";
import type { Conversation } from "@totem/types";
import { auth } from "$lib/state/auth.svelte";
import { fetchApi } from "$lib/utils/api";
import ConversationList from "$lib/components/conversations/conversation-list.svelte";
import ConversationHeader from "$lib/components/conversations/conversation-header.svelte";
import MessageThread from "$lib/components/conversations/message-thread.svelte";
import MessageInput from "$lib/components/conversations/message-input.svelte";

let conversations = $state<Conversation[]>([]);
let selectedPhone = $state<string | null>(null);
let conversationDetail = $state<any>(null);
let messageText = $state("");
let polling: Timer | null = null;

async function loadConversations() {
    try {
        conversations = await fetchApi<Conversation[]>("/api/conversations");
    } catch {
        auth.logout();
    }
}

async function loadConversationDetail(phone: string) {
    conversationDetail = await fetchApi<any>(`/api/conversations/${phone}`);
}

async function handleTakeover() {
    if (!selectedPhone) return;
    await fetchApi(`/api/conversations/${selectedPhone}/takeover`, {
        method: "POST",
    });
    await loadConversations();
    await loadConversationDetail(selectedPhone);
}

async function handleSendMessage() {
    if (!(selectedPhone && messageText.trim())) return;

    await fetchApi(`/api/conversations/${selectedPhone}/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: messageText }),
    });

    messageText = "";
    await loadConversationDetail(selectedPhone);
}

$effect(() => {
    if (selectedPhone) {
        loadConversationDetail(selectedPhone);
    }
});

onMount(() => {
    if (!auth.isAuthenticated) {
        window.location.href = "/login";
        return;
    }

    loadConversations();
    polling = setInterval(() => {
        loadConversations();
        if (selectedPhone) loadConversationDetail(selectedPhone);
    }, 2000);

    return () => {
        if (polling) clearInterval(polling);
    };
});
</script>

<div class="flex h-[calc(100vh-80px)]">
	<ConversationList
		{conversations}
		{selectedPhone}
		onSelect={(phone) => selectedPhone = phone}
	/>

	<div class="hidden md:flex flex-col flex-1 bg-cream-50 relative">
		{#if selectedPhone && conversationDetail}
			{@const conv = conversationDetail.conversation}
			{@const msgs = conversationDetail.messages}

			<ConversationHeader
				conversation={conv}
				phone={selectedPhone}
				onTakeover={handleTakeover}
			/>

			<MessageThread messages={msgs} />

			{#if conv.status === "human_takeover"}
				<MessageInput
					bind:value={messageText}
					onSend={handleSendMessage}
				/>
			{/if}
		{:else}
			<div class="flex-1 flex flex-col items-center justify-center text-ink-300 opacity-50">
				<span class="text-9xl mb-4 font-serif italic">&larr;</span>
				<p class="font-serif text-lg">Seleccione un cliente.</p>
			</div>
		{/if}
	</div>
</div>
