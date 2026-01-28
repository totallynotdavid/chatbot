<script lang="ts">
  import { formatTime } from "$lib/utils/formatters";
  import type { Snippet } from "svelte";
  import type { MessageType } from "@totem/types";

  type Props = {
    direction: "inbound" | "outbound";
    type: MessageType;
    content: string;
    status?: string;
    createdAt: string;
    actions?: Snippet;
    currentUserSide?: "inbound" | "outbound";
  };

  let {
    direction,
    type,
    content,
    status,
    createdAt,
    actions,
    currentUserSide = "outbound",
  }: Props = $props();

  const isMe = $derived(direction === currentUserSide);
</script>

<div class="flex {isMe ? 'justify-end' : 'justify-start'} group">
  <div
    class="relative max-w-xl p-4 {isMe
      ? 'bg-ink-900 text-cream-50'
      : 'bg-white text-ink-900 border border-ink-900/10'}"
  >
    {#if actions}
      <div
        class="absolute -top-3 -right-3 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      >
        {@render actions()}
      </div>
    {/if}
    {#if type === "image"}
      <img
        src="/media/{content}"
        alt="Imagen"
        class="max-w-full h-auto mb-4 border border-ink-900/10"
      />
    {:else}
      <p
        class="font-serif text-base leading-relaxed whitespace-pre-wrap {isMe
          ? 'text-cream-50'
          : 'text-ink-900'}"
      >
        {content}
      </p>
    {/if}
    <span
      class="text-[10px] font-mono uppercase tracking-widest block mt-2 {isMe
        ? 'text-cream-50/40'
        : 'text-ink-300'}"
    >
      {formatTime(createdAt)}{#if status}
        • {status}{/if}
    </span>
  </div>
</div>
