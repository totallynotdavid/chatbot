<script lang="ts">
type SelectItem = {
    value: string;
    label: string;
    disabled?: boolean;
};

type Props = {
    id?: string;
    value?: string;
    disabled?: boolean;
    error?: boolean;
    class?: string;
    placeholder?: string;
    items: SelectItem[];
    onchange?: (e: Event & { currentTarget: HTMLSelectElement }) => void;
};

let {
    id,
    value = $bindable(""),
    disabled = false,
    error = false,
    class: className = "",
    placeholder = "Seleccionar...",
    items,
    onchange,
}: Props = $props();

let open = $state(false);
let triggerRef: HTMLButtonElement | undefined = $state();
let selectedIndex = $state(-1);

const baseStyles = "block w-full bg-transparent border-b px-0 py-2 min-h-[44px] text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1 transition-colors duration-200 text-[16px] md:text-lg font-serif touch-action-manipulation";
const normalBorder = "border-ink-900/30 data-[open]:border-ink-900";
const errorBorder = "border-red-600 data-[open]:border-red-600";

const selectedLabel = $derived(
    items.find((item) => item.value === value)?.label
);

function handleSelect(v: string) {
    if (v !== value) {
        value = v;
        if (onchange) {
            const fakeEvent = {
                currentTarget: { value: v } as HTMLSelectElement,
            } as Event & { currentTarget: HTMLSelectElement };
            onchange(fakeEvent);
        }
    }
    open = false;
}

function handleKeydown(e: KeyboardEvent) {
    const availableItems = items.filter(item => !item.disabled);
    
    switch (e.key) {
        case "ArrowDown":
            e.preventDefault();
            selectedIndex = Math.min(selectedIndex + 1, availableItems.length - 1);
            break;
        case "ArrowUp":
            e.preventDefault();
            selectedIndex = Math.max(selectedIndex - 1, 0);
            break;
        case "Enter":
            e.preventDefault();
            if (selectedIndex >= 0 && selectedIndex < availableItems.length) {
                const item = availableItems[selectedIndex];
                if (item) {
                    handleSelect(item.value);
                }
            }
            break;
    }
}

// ESC key and click outside handler
$effect(() => {
    if (!open) return;

    const handleKeydown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            open = false;
        }
    };

    const handleClickOutside = (e: MouseEvent) => {
        if (triggerRef && !triggerRef.contains(e.target as Node)) {
            const dropdown = document.querySelector("[data-select-dropdown]");
            if (dropdown && !dropdown.contains(e.target as Node)) {
                open = false;
            }
        }
    };

    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("click", handleClickOutside);
    
    return () => {
        document.removeEventListener("keydown", handleKeydown);
        document.removeEventListener("click", handleClickOutside);
    };
});
</script>

<div class="relative">
	<button
		bind:this={triggerRef}
		type="button"
		{disabled}
		aria-haspopup="listbox"
		aria-expanded={open}
		data-open={open ? "" : undefined}
		onclick={() => !disabled && (open = !open)}
		class="{baseStyles} {error ? errorBorder : normalBorder} {className} flex items-center justify-between cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
	>
		<span class="text-ink-900">{selectedLabel || placeholder}</span>
		<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-ink-400 shrink-0" aria-hidden="true">
			<polyline points="6 9 12 15 18 9"></polyline>
		</svg>
	</button>

	{#if open}
		<div 
			data-select-dropdown
			class="absolute top-full left-0 right-0 mt-1 bg-white border border-ink-200 shadow-xl max-h-75 overflow-auto z-100 rounded-md p-1"
			onkeydown={handleKeydown}
			role="listbox"
			tabindex="-1"
		>
			{#each items as { value: itemValue, label, disabled: itemDisabled }, i (itemValue)}
				<button
					type="button"
					disabled={itemDisabled}
					onclick={() => !itemDisabled && handleSelect(itemValue)}
					class="w-full min-h-10 px-4 py-3 hover:bg-ink-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-1 cursor-pointer text-ink-900 text-left rounded transition-colors touch-action-manipulation disabled:opacity-50 disabled:cursor-not-allowed {value === itemValue ? 'bg-ink-50 font-medium' : ''} {selectedIndex === i ? 'bg-ink-100' : ''}"
					role="option"
					aria-selected={value === itemValue}
					tabindex={itemDisabled ? -1 : 0}
				>
					<span class="flex items-center gap-3">
						<span class="w-4 flex items-center justify-center">
							{#if value === itemValue}<span class="text-ink-900 font-bold">✓</span>{/if}
						</span>
						<span class:font-medium={value === itemValue}>{label}</span>
					</span>
				</button>
			{/each}
		</div>
	{/if}
</div>
