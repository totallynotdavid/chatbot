<script lang="ts">
type Props = {
    id?: string;
    type?: "text" | "number" | "email" | "password";
    value?: string | number;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
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
    class: className = "",
    oninput,
    onchange,
}: Props = $props();

const baseStyles = "block w-full bg-transparent border-b px-0 py-2 text-ink-900 focus:ring-0 placeholder-ink-400/50 transition-colors duration-200 outline-none text-lg font-serif";
const normalBorder = "border-ink-900/30 focus:border-ink-900";
const errorBorder = "border-red-600 focus:border-red-600";
</script>

<input
	{id}
	{type}
	{placeholder}
	{disabled}
	bind:value
	{oninput}
	{onchange}
	class="{baseStyles} {error ? errorBorder : normalBorder} {className}"
/>
