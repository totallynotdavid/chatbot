<script lang="ts">
type Props = {
  label: string;
  value: string | number;
  subtitle?: string;
  variant?: "default" | "success" | "warning";
};

let { label, value, subtitle, variant = "default" }: Props = $props();

const variantColors = {
  default: "text-ink-900",
  success: "text-green-700",
  warning: "text-blue-700",
};
</script>

<div class="bg-white border border-cream-200 p-6">
	<span class="text-xs font-bold uppercase tracking-widest text-ink-400 block mb-2">
		{label}
	</span>
	<span class="text-4xl font-serif font-bold {variantColors[variant]}">
		{value}
	</span>
	{#if subtitle}
		<span class="text-xs text-ink-400 mt-1 block">{subtitle}</span>
	{/if}
</div>
