<script lang="ts">
import type { Product } from "@totem/types";
import FileUpload from "$lib/components/ui/file-upload.svelte";
import Button from "$lib/components/ui/button.svelte";

type Props = {
    product: Product | null;
    mainImage: File | null;
    specsImage: File | null;
    mainImageError?: string;
    isExtracting?: boolean;
    onMainImageChange: (file: File | null) => void;
    onSpecsImageChange: (file: File | null) => void;
    onExtract?: () => void;
};

let {
    product,
    mainImage = $bindable(null),
    specsImage = $bindable(null),
    mainImageError,
    isExtracting = false,
    onMainImageChange,
    onSpecsImageChange,
    onExtract,
}: Props = $props();
</script>

<div class="mb-8 p-6 bg-ink-50 rounded-lg border border-ink-100">
	<span class="block text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
		{product ? "Reemplazar imágenes (opcional)" : "Imágenes del producto"}
	</span>

	<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
		<div>
			<FileUpload
				bind:file={mainImage}
				error={!!mainImageError}
				placeholder={product ? "Nueva imagen principal" : "Imagen principal*"}
				onchange={onMainImageChange}
			/>
			{#if mainImageError}
				<span class="block mt-2 text-xs text-red-600 font-medium">{mainImageError}</span>
			{/if}
			{#if mainImage}
				<div class="flex justify-between items-center mt-2">
					<button
						onclick={() => onMainImageChange(null)}
						class="text-xs text-red-600 hover:underline font-medium uppercase tracking-wide"
					>
						Cancelar cambio
					</button>
					{#if !product && onExtract}
						<Button
							variant="ghost"
							onclick={onExtract}
							disabled={isExtracting}
							class="text-xs px-2! py-1!"
						>
							{isExtracting ? "Analizando..." : "✨ Autocompletar"}
						</Button>
					{/if}
				</div>
			{/if}
		</div>

		<div>
			<FileUpload
				bind:file={specsImage}
				placeholder="Imagen con especificaciones"
				onchange={onSpecsImageChange}
			/>
			{#if specsImage}
				<button
					onclick={() => onSpecsImageChange(null)}
					class="text-xs text-red-600 hover:underline mt-2 font-medium uppercase tracking-wide"
				>
					Cancelar cambio
				</button>
			{/if}
		</div>
	</div>
</div>
