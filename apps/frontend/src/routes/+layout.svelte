<script lang="ts">
import "$lib/styles/global.css";
import { onMount } from "svelte";
import { auth } from "$lib/state/auth.svelte";
import ToastContainer from "$lib/components/shared/toast-container.svelte";
import type { LayoutData } from "./$types";

let { children, data }: { children: any; data: LayoutData } = $props();

onMount(() => {
    auth.hydrate(data.user ?? null);
});
</script>

{@render children()}
<ToastContainer />
