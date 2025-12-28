<script lang="ts">
import { onMount } from "svelte";
import type { Conversation } from "@totem/types";
import { fetchApi } from "$lib/utils/api";
import ConversationList from "$lib/components/conversations/conversation-list.svelte";
import ConversationHeader from "$lib/components/conversations/conversation-header.svelte";
import MessageThread from "$lib/components/conversations/message-thread.svelte";
import MessageInput from "$lib/components/conversations/message-input.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let localConversations = $state<Conversation[]>([]);
let selectedPhone = $state<string | null>(null);
let conversationDetail = $state<any>(null);
let messageText = $state("");
let polling: Timer | null = null;

let conversations = $derived(localConversations.length > 0 ? localConversations : data.conversations);

async function loadConversations() {
    try {
        localConversations = await fetchApi<Conversation[]>("/api/conversations");
    } catch (error) {
        console.error("Failed to load conversations:", error);
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

async function handleLoadInSimulator() {
    if (!selectedPhone) return;
    window.location.href = `/dashboard/simulator?load=${selectedPhone}`;
}

$effect(() => {
    if (selectedPhone) {
        loadConversationDetail(selectedPhone);
    }
});

onMount(() => {
    polling = setInterval(() => {
        loadConversations();
        if (selectedPhone) loadConversationDetail(selectedPhone);
    }, 2000);

    return () => {
        if (polling) clearInterval(polling);
    };
});
</script>

<PageTitle title="Conversaciones" />

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
				onLoadInSimulator={handleLoadInSimulator}
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
