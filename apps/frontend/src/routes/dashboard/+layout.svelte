<script lang="ts">
import { page } from "$app/state";
import DashboardNav from "$lib/components/shared/dashboard-nav.svelte";

let { children } = $props();

let isHomePage = $derived(page.url.pathname === "/dashboard");
</script>

{#if isHomePage}
	{@render children()}
{:else}
	<div class="min-h-screen bg-cream-100 flex flex-col">
		<DashboardNav />
		<main class="flex-1">
			{@render children()}
		</main>
	</div>
{/if}
