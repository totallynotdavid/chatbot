<script lang="ts">
type Props = {
    id?: string;
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    error?: boolean;
    rows?: number;
    name?: string;
    autocomplete?: string;
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
    name,
    autocomplete,
    class: className = "",
    oninput,
}: Props = $props();

const baseStyles = "block w-full bg-transparent border-b px-0 py-2 min-h-[44px] text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1 placeholder-ink-400/50 transition-colors duration-200 text-[16px] md:text-lg font-serif resize-none touch-action-manipulation";
const normalBorder = "border-ink-900/30 focus-visible:border-ink-900";
const errorBorder = "border-red-600 focus-visible:border-red-600";
</script>

<textarea
	{id}
	{placeholder}
	{disabled}
	{rows}
	name={name}
	autocomplete={autocomplete as any}
	bind:value
	{oninput}
	class="{baseStyles} {error ? errorBorder : normalBorder} {className}"
></textarea>
