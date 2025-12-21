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

const baseStyles = "w-5 h-5 min-w-[20px] min-h-[20px] border-2 border-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 rounded-none transition-colors flex items-center justify-center cursor-pointer appearance-none touch-action-manipulation disabled:opacity-50 disabled:cursor-not-allowed";

function handleChange(e: Event & { currentTarget: HTMLInputElement }) {
    checked = e.currentTarget.checked;
    if (onchange) {
        onchange(e);
    }
}
</script>

<input
    type="checkbox"
    {id}
    {disabled}
    bind:checked
    onchange={handleChange}
    class="{baseStyles} {checked ? 'bg-ink-900' : 'bg-white'} {className}"
/>

<style>
input[type="checkbox"]:checked {
    background-image: url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='20 6 9 17 4 12'%3e%3c/polyline%3e%3c/svg%3e");
    background-size: 14px 14px;
    background-position: center;
    background-repeat: no-repeat;
}
</style>
