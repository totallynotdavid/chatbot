<script lang="ts">
type Props = {
	id?: string;
	checked?: boolean;
	disabled?: boolean;
	class?: string;
	onchange?: (e: Event & { currentTarget: HTMLInputElement }) => void;
};

let {
	id,
	checked = $bindable(false),
	disabled = false,
	class: className = "",
	onchange,
}: Props = $props();

const baseStyles = "w-5 h-5 border-ink-900 text-ink-900 focus:ring-ink-900 focus:ring-offset-0 rounded-none transition-colors";
</script>

<input
	{id}
	type="checkbox"
	{disabled}
	bind:checked
	{onchange}
	class="{baseStyles} {className}"
/>
