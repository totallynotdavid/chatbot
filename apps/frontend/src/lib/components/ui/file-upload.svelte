<script lang="ts">
type Props = {
    accept?: string;
    file?: File | null;
    error?: boolean;
    placeholder?: string;
    class?: string;
    onchange?: (file: File | null) => void;
};

let {
    accept = "image/*",
    file = $bindable(null),
    error = false,
    placeholder = "Subir archivo",
    class: className = "",
    onchange,
}: Props = $props();

let isDragging = $state(false);

function handleFileChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const selectedFile = input.files?.[0] || null;
    file = selectedFile;
    onchange?.(selectedFile);
}

function handleDrop(e: DragEvent) {
    e.preventDefault();
    isDragging = false;
    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile?.type.match(accept.replace("*", ".*"))) {
        file = droppedFile;
        onchange?.(droppedFile);
    }
}

const baseStyles = "flex flex-col items-center justify-center w-full p-4 min-h-[100px] border transition-all cursor-pointer focus-within:outline-none focus-within:ring-2 focus-within:ring-ink-900 focus-within:ring-offset-2 touch-action-manipulation";
const normalBorder = "border-dashed border-ink-300 bg-white hover:bg-ink-50 hover:border-ink-400";
const errorBorder = "border-dashed border-red-600 bg-red-50";
const activeBorder = "border-solid border-ink-900 bg-ink-50";
const fileBorder = "border-solid border-ink-900 bg-ink-50";
</script>

<label
	class="{baseStyles} {error ? errorBorder : file ? fileBorder : isDragging ? activeBorder : normalBorder} {className}"
	ondragover={(e) => { e.preventDefault(); isDragging = true; }}
	ondragleave={() => isDragging = false}
	ondrop={handleDrop}
>
	{#if file}
		<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mb-2 text-ink-900">
			<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
			<polyline points="14 2 14 8 20 8"/>
		</svg>
		<span class="text-sm font-medium text-ink-900 truncate max-w-full px-2">{file.name}</span>
		<span class="text-[10px] text-ink-400 mt-1">Clic para cambiar</span>
	{:else}
		<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="mb-2">
			<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
			<polyline points="17 8 12 3 7 8"/>
			<line x1="12" y1="3" x2="12" y2="15"/>
		</svg>
		<span class="text-sm font-medium text-ink-600">{placeholder}</span>
	{/if}
	<input type="file" {accept} onchange={handleFileChange} class="hidden" />
</label>
