<script lang="ts">
type Props = {
    label: string;
    value: string | number;
    variant?: "default" | "success" | "error";
};

let { label, value, variant = "default" }: Props = $props();

const variantColors = {
    default: "text-ink-900",
    success: "text-green-700",
    error: "text-red-700",
};
</script>

<div class="flex justify-between items-baseline border-b border-cream-200 pb-2">
	<span class="text-sm text-ink-600">{label}</span>
	<span class="text-2xl font-serif font-bold {variantColors[variant]}">
		{value}
	</span>
</div>
