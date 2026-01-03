<script lang="ts">
import type { Snippet } from "svelte";

type Props = {
  variant?: "default" | "success" | "error" | "warning";
  class?: string;
  children: Snippet;
};

let { variant = "default", class: className = "", children }: Props = $props();

const baseStyles =
  "inline-flex items-center px-2 py-1 text-[10px] font-bold border tracking-wider";

const variants = {
  default: "bg-ink-100 text-ink-800 border-ink-200",
  success: "bg-green-100 text-green-800 border-green-200",
  error: "bg-red-100 text-red-800 border-red-200",
  warning: "bg-yellow-100 text-yellow-800 border-yellow-200",
};
</script>

<span class="{baseStyles} {variants[variant]} {className}">
	{@render children()}
</span>
