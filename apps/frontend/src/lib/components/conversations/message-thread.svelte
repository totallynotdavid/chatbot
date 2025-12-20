<script lang="ts">
import MessageBubble from "./message-bubble.svelte";

type Message = {
    id: string;
    direction: "inbound" | "outbound";
    type: "text" | "image";
    content: string;
    status?: string;
    created_at: string;
};

type Props = {
    messages: Message[];
};

let { messages }: Props = $props();
</script>

<div class="flex-1 overflow-y-auto p-8 space-y-6">
	{#if messages.length === 0}
		<div class="flex justify-center py-12">
			<span class="text-xs text-ink-300 uppercase tracking-widest border-b border-ink-200 pb-1">
				Inicio de conversación
			</span>
		</div>
	{/if}

	{#each messages as msg (msg.id)}
		<MessageBubble
			direction={msg.direction}
			type={msg.type}
			content={msg.content}
			status={msg.status}
			createdAt={msg.created_at}
		/>
	{/each}
</div>
