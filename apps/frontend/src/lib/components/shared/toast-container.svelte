<script lang="ts">
import { toast } from "$lib/state/toast.svelte";
import Toast from "./toast.svelte";
</script>

<div class="fixed bottom-8 right-8 z-9999 flex flex-col gap-3 items-end pointer-events-none">
	{#each toast.items as item (item.id)}
		<div class="pointer-events-auto">
			<Toast
				id={item.id}
				message={item.message}
				type={item.type}
				onDismiss={toast.remove}
			/>
		</div>
	{/each}
</div>
