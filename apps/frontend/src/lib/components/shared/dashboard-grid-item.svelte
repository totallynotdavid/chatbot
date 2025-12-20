<script lang="ts">
type Props = {
	href: string;
	number: string;
	category: string;
	title: string;
	variant?: "default" | "dark";
};

let { href, number, category, title, variant = "default" }: Props = $props();

const variantStyles = {
	default: "hover:bg-white",
	dark: "hover:bg-ink-900",
};

const numberStyles = {
	default: "text-cream-300 group-hover:text-ink-100",
	dark: "text-cream-300 group-hover:text-ink-800",
};

const categoryStyles = {
	default: "text-ink-400 group-hover:text-ink-400",
	dark: "text-ink-400 group-hover:text-ink-500",
};

const titleStyles = {
	default: "text-ink-900 group-hover:underline",
	dark: "text-ink-900 group-hover:text-cream-50 group-hover:underline",
};
</script>

<a
	{href}
	class="group border-b border-r border-ink-900/10 p-12 {variantStyles[variant]} transition-all flex flex-col justify-between relative overflow-hidden"
>
	<span class="text-6xl font-serif {numberStyles[variant]} transition-colors absolute top-4 right-4 z-0">
		{number}
	</span>
	<div class="relative z-10 mt-auto">
		<span class="text-xs font-bold uppercase tracking-widest {categoryStyles[variant]} mb-2 block">
			{category}
		</span>
		<h2 class="text-3xl font-serif {titleStyles[variant]} underline-offset-4 decoration-1">
			{title}
		</h2>
	</div>
</a>
