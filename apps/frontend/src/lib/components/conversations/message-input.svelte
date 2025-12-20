<script lang="ts">
import Button from "$lib/components/ui/button.svelte";

type Props = {
    value: string;
    disabled?: boolean;
    onSend: () => void;
};

let { value = $bindable(""), disabled = false, onSend }: Props = $props();

function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
    }
}
</script>

<div class="p-6 border-t border-ink-900/10 bg-white">
	<div class="flex gap-4">
		<input
			bind:value
			{disabled}
			onkeydown={handleKeydown}
			class="flex-1 bg-white p-4 text-lg font-serif outline-none border-b border-ink-900/30 focus:border-ink-900 placeholder-ink-300"
			placeholder="Escriba su mensaje..."
		/>
		<Button onclick={onSend} disabled={disabled || !value.trim()}>
			Enviar
		</Button>
	</div>
	<p class="text-xs text-ink-400 mt-2 font-mono">
		Enter para enviar • Shift+Enter para salto de línea
	</p>
</div>
