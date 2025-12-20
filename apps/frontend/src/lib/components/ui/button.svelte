<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
    variant?: "primary" | "secondary" | "ghost";
    disabled?: boolean;
    class?: string;
    type?: "button" | "submit" | "reset";
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
};

let {
    variant = "primary",
    disabled = false,
    class: className = "",
    type = "button",
    onclick,
    children,
}: Props = $props();

const baseStyles = "px-6 py-3 rounded-full transition-all duration-200 font-medium text-xs tracking-widest uppercase disabled:opacity-50 disabled:cursor-not-allowed";

const variants = {
    primary: "bg-ink-900 text-cream-50 hover:bg-ink-600",
    secondary: "bg-transparent border border-ink-200 text-ink-900 hover:bg-ink-50 hover:border-ink-900",
    ghost: "bg-transparent text-ink-600 hover:bg-ink-50",
};
</script>

<button
	{type}
	{disabled}
	{onclick}
	class="{baseStyles} {variants[variant]} {className}"
>
	{@render children()}
</button>
