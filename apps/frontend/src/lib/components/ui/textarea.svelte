<script lang="ts">
type Props = {
    id?: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    rows?: number;
    class?: string;
    oninput?: (e: Event & { currentTarget: HTMLTextAreaElement }) => void;
};

let {
    id,
    value = $bindable(""),
    placeholder,
    disabled = false,
    error = false,
    rows = 3,
    class: className = "",
    oninput,
}: Props = $props();

const baseStyles = "block w-full bg-transparent border-b px-0 py-2 text-ink-900 focus:ring-0 placeholder-ink-400/50 transition-colors duration-200 outline-none text-lg font-serif resize-none";
const normalBorder = "border-ink-900/30 focus:border-ink-900";
const errorBorder = "border-red-600 focus:border-red-600";
</script>

<textarea
	{id}
	{placeholder}
	{disabled}
	{rows}
	bind:value
	{oninput}
	class="{baseStyles} {error ? errorBorder : normalBorder} {className}"
></textarea>
