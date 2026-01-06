<script lang="ts">
type Props = {
  checked?: boolean;
  label: string;
  description?: string;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  variant?: "default" | "danger";
};

let {
  checked = $bindable(false),
  label,
  description,
  disabled = false,
  onCheckedChange,
  variant = "default",
}: Props = $props();

const switchId = `switch-${Math.random().toString(36).slice(2, 9)}`;
const labelId = `${switchId}-label`;

function toggle() {
  if (disabled) return;
  checked = !checked;
  onCheckedChange?.(checked);
}

// Colors based on Ink & Cream theme
const colors = {
  default: {
    on: "bg-ink-900 border-ink-900",
    off: "bg-cream-100 border-cream-300 hover:border-ink-400",
    thumb: "bg-white",
  },
  danger: {
    on: "bg-red-600 border-red-600",
    off: "bg-cream-100 border-cream-300 hover:border-red-300",
    thumb: "bg-white",
  },
};

let activeColor = $derived(checked ? colors[variant].on : colors[variant].off);
</script>

<div class="flex items-center justify-between gap-4 py-4 group">
    <div class="flex-1">
        <div 
            id={labelId}
            class="text-sm font-medium text-ink-900 block select-none {disabled ? 'opacity-50' : ''}"
        >
            {label}
        </div>
        {#if description}
            <p class="text-xs text-ink-500 mt-1 select-none {disabled ? 'opacity-50' : ''}">
                {description}
            </p>
        {/if}
    </div>

    <button
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        onclick={toggle}
        disabled={disabled}
        class="
            relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-ink-900 focus:ring-offset-2
            {activeColor}
            {disabled ? 'opacity-50 cursor-not-allowed' : ''}
        "
    >
        <span class="sr-only">{label}</span>
        <span
            aria-hidden="true"
            class="
                pointer-events-none inline-block h-5 w-5 transform rounded-full shadow ring-0 transition duration-200 ease-in-out
                {checked ? 'translate-x-5' : 'translate-x-0'}
                {colors[variant].thumb}
            "
        ></span>
    </button>
</div>
