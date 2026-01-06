<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  title: string;
  description?: string;
  action?: Snippet;
  children: Snippet;
};

let { title, description, action, children }: Props = $props();
</script>

<div class="bg-white border border-ink-100 shadow-sm relative overflow-hidden group transition-shadow hover:shadow-md">
    <!-- Header -->
    <div class="px-6 py-5 border-b border-ink-50 bg-white flex justify-between items-start gap-4">
        <div>
            <h3 class="font-serif text-lg text-ink-900 leading-none">{title}</h3>
            {#if description}
                <p class="text-sm text-ink-500 mt-2 max-w-xl text-pretty leading-relaxed">
                    {description}
                </p>
            {/if}
        </div>
        {#if action}
            <div class="shrink-0">
                {@render action()}
            </div>
        {/if}
    </div>

    <!-- Content -->
    <div class="p-0">
        {@render children()}
    </div>
</div>
