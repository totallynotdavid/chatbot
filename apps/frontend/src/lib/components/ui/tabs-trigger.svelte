<script lang="ts">
import { getContext } from "svelte";

type Props = {
  value: string;
  children: any;
};

let { value, children }: Props = $props();

const tabs = getContext<{ getValue: () => string; setValue: (v: string) => void }>("tabs");

let isSelected = $derived(tabs.getValue() === value);
</script>

<button
  class="px-4 py-2 text-sm font-medium transition-colors border-b-2 {isSelected
    ? 'border-emerald-600 text-emerald-900'
    : 'border-transparent text-ink-500 hover:text-ink-900 hover:border-ink-300'}"
  onclick={() => tabs.setValue(value)}
>
  {@render children()}
</button>
