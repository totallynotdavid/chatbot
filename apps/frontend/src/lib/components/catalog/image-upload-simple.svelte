<script lang="ts">
import FileUpload from "$lib/components/ui/file-upload.svelte";

type Props = {
  hasExistingImage: boolean;
  image: File | null;
  error?: string;
  onImageChange: (file: File | null) => void;
};

let {
  hasExistingImage,
  image = $bindable(null),
  error,
  onImageChange,
}: Props = $props();
</script>

<div class="mb-6 p-6 bg-ink-50 rounded-lg border border-ink-100">
  <span class="block text-xs font-bold uppercase tracking-widest text-ink-400 mb-4">
    {hasExistingImage ? "Reemplazar imagen (opcional)" : "Imagen comercial*"}
  </span>

  <div>
    <FileUpload
      bind:file={image}
      error={!!error}
      placeholder={hasExistingImage ? "Subir nueva imagen..." : "Subir imagen..."}
      onchange={onImageChange}
    />
    {#if error}
      <span class="block mt-2 text-xs text-red-600 font-medium">{error}</span>
    {/if}
    {#if image}
      <div class="flex justify-end mt-2">
        <button
          onclick={() => onImageChange(null)}
          class="text-xs text-red-600 hover:underline font-medium uppercase tracking-wide"
        >
          Cancelar cambio
        </button>
      </div>
    {/if}
  </div>
</div>
