<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  variant?: "primary" | "secondary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  class?: string;
  type?: "button" | "submit" | "reset";
  href?: string;
  onclick?: (e: MouseEvent) => void;
  children: Snippet;
};

let {
  variant = "primary",
  size = "md",
  disabled = false,
  class: className = "",
  type = "button",
  href,
  onclick,
  children,
}: Props = $props();

const sizeStyles = {
  sm: "px-4 py-2 text-[10px] min-h-8",
  md: "px-6 py-3 text-xs min-h-10",
  lg: "px-8 py-4 text-sm min-h-12",
};

const baseStyles =
  "rounded-full transition-all duration-200 font-medium tracking-widest uppercase disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink-900 focus-visible:ring-offset-2 touch-action-manipulation inline-flex items-center justify-center text-center";

const variants = {
  primary: "bg-ink-900 text-cream-50 hover:bg-ink-600 focus-visible:bg-ink-600",
  secondary:
    "bg-transparent border border-ink-200 text-ink-900 hover:bg-ink-50 hover:border-ink-900 focus-visible:bg-ink-50 focus-visible:border-ink-900",
  outline:
    "bg-white border-2 border-ink-900 text-ink-900 hover:bg-ink-900 hover:text-white focus-visible:bg-ink-900 focus-visible:text-white",
  ghost: "bg-transparent text-ink-600 hover:bg-ink-50 focus-visible:bg-ink-50",
};
</script>

{#if href}
	<a
		{href}
		class="{baseStyles} {sizeStyles[size]} {variants[variant]} {className}"
		role="button"
		tabindex={disabled ? -1 : 0}
		aria-disabled={disabled}
	>
		{@render children()}
	</a>
{:else}
	<button
		{type}
		{disabled}
		{onclick}
		class="{baseStyles} {sizeStyles[size]} {variants[variant]} {className}"
	>
		{@render children()}
	</button>
{/if}
