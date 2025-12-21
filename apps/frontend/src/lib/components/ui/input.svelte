<script lang="ts">
type Props = {
    id?: string;
    type?: "text" | "number" | "email" | "password";
    value?: string | number;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    autocomplete?: string;
    name?: string;
    class?: string;
    oninput?: (e: Event & { currentTarget: HTMLInputElement }) => void;
    onchange?: (e: Event & { currentTarget: HTMLInputElement }) => void;
};

let {
    id,
    type = "text",
    value = $bindable(""),
    placeholder,
    disabled = false,
    error = false,
    autocomplete,
    name,
    class: className = "",
    oninput,
    onchange,
}: Props = $props();

const baseStyles = "block w-full bg-transparent border-b px-0 py-2 min-h-[44px] text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1 placeholder-ink-400/50 transition-colors duration-200 text-[16px] md:text-lg font-serif touch-action-manipulation";
const normalBorder = "border-ink-900/30 focus-visible:border-ink-900";
const errorBorder = "border-red-600 focus-visible:border-red-600";
</script>

<input
	{id}
	{type}
	{placeholder}
	{disabled}
	name={name}
	autocomplete={autocomplete as any}
	spellcheck={type === "email" || type === "password" ? "false" : undefined}
	bind:value
	{oninput}
	{onchange}
	class="{baseStyles} {error ? errorBorder : normalBorder} {className}"
/>
