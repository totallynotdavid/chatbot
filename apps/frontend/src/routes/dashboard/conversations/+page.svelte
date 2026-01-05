<script lang="ts">
import { onMount } from "svelte";
import type { Conversation } from "@totem/types";
import { fetchApi } from "$lib/utils/api";
import ConversationList from "$lib/components/conversations/conversation-list.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

let localConversations = $state<Conversation[]>([]);
let polling: Timer | null = null;

let conversations = $derived(
  localConversations.length > 0 ? localConversations : data.conversations,
);

async function loadConversations() {
  try {
    localConversations = await fetchApi<Conversation[]>("/api/conversations");
  } catch (error) {
    console.error("Failed to load conversations:", error);
  }
}

onMount(() => {
  polling = setInterval(() => {
    loadConversations();
  }, 2000);

  return () => {
    if (polling) clearInterval(polling);
  };
});
</script>

<PageTitle title="Conversaciones" />

<div class="flex h-[calc(100vh-65px)] overflow-hidden bg-white">
	<ConversationList
		{conversations}
		selectedPhone={null}
	/>

	<div class="hidden md:flex flex-col flex-1 bg-cream-100 relative min-w-0">
		<div class="flex-1 flex flex-col items-center justify-center text-ink-300 opacity-50">
			<span class="text-9xl mb-4 font-serif italic">&larr;</span>
			<p class="font-serif text-lg">Seleccione una conversación.</p>
		</div>
	</div>
</div>
