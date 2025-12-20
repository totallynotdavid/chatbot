<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
    id?: string;
    value?: string;
    disabled?: boolean;
    error?: boolean;
    class?: string;
    onchange?: (e: Event & { currentTarget: HTMLSelectElement }) => void;
    children: Snippet;
};

let {
    id,
    value = $bindable(""),
    disabled = false,
    error = false,
    class: className = "",
    onchange,
    children,
}: Props = $props();

const baseStyles = "block w-full bg-transparent border-b px-0 py-2 text-ink-900 focus:ring-0 transition-colors duration-200 outline-none text-lg font-serif appearance-none";
const normalBorder = "border-ink-900/30 focus:border-ink-900";
const errorBorder = "border-red-600 focus:border-red-600";
</script>

<select
	{id}
	{disabled}
	bind:value
	{onchange}
	class="{baseStyles} {error ? errorBorder : normalBorder} {className}"
>
	{@render children()}
</select>
