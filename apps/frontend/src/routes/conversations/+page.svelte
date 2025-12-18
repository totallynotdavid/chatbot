<script lang="ts">
    import { onMount } from 'svelte';
    import { user } from '$lib/state.svelte';
    import type { Conversation } from '@totem/types';

    let conversations = $state<Conversation[]>([]);
    let selectedPhone = $state<string | null>(null);
    let messageText = $state('');

    async function load() {
        const res = await fetch('/api/conversations');
        if (res.status === 401) user.logout();
        else conversations = await res.json();
    }

    async function takeover(phone: string) {
        await fetch(`/api/conversations/${phone}/takeover`, { method: 'POST' });
        load();
    }

    async function sendMessage() {
        if (!selectedPhone || !messageText) return;
        await fetch(`/api/conversations/${selectedPhone}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: messageText })
        });
        messageText = '';
        alert('Sent');
    }

    onMount(load);
</script>

<div class="flex h-screen">
    <div class="w-1/3 border-r bg-gray-50 p-4 overflow-y-auto">
        <h2 class="font-bold mb-4">Inbox</h2>
        {#each conversations as conv}
            <button onclick={() => selectedPhone = conv.phone_number} class="w-full text-left p-3 hover:bg-gray-200 rounded border-b">
                <div class="font-bold">{conv.phone_number}</div>
                <div class="text-sm">{conv.current_state}</div>
                <div class="text-xs text-gray-500">Status: {conv.status}</div>
            </button>
        {/each}
    </div>

    <div class="w-2/3 p-4 flex flex-col">
        {#if selectedPhone}
            {@const activeConv = conversations.find(c => c.phone_number === selectedPhone)}
            {#if activeConv}
                <div class="flex justify-between border-b pb-4 mb-4">
                    <h2 class="font-bold text-xl">{selectedPhone}</h2>
                    {#if activeConv.status !== 'human_takeover'}
                        <button onclick={() => takeover(selectedPhone!)} class="bg-red-600 text-white px-3 py-1 rounded text-sm">
                            Take Over
                        </button>
                    {:else}
                        <span class="bg-yellow-100 text-yellow-800 px-3 py-1 rounded text-sm">Human Active</span>
                    {/if}
                </div>

                <div class="flex-grow bg-gray-100 p-4 rounded mb-4 overflow-y-auto">
                    <p class="text-center text-gray-500 italic">Message history not loaded in simple view.</p>
                </div>

                {#if activeConv.status === 'human_takeover'}
                    <div class="flex gap-2">
                        <input bind:value={messageText} class="flex-grow border p-2 rounded" placeholder="Type a message..." />
                        <button onclick={sendMessage} class="bg-blue-600 text-white px-4 rounded">Send</button>
                    </div>
                {/if}
            {/if}
        {:else}
            <div class="flex h-full items-center justify-center text-gray-400">Select a conversation</div>
        {/if}
    </div>
</div>
