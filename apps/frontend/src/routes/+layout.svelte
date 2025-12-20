<script lang="ts">
import "$lib/styles/global.css";
import { onMount } from "svelte";
import { auth } from "$lib/state/auth.svelte";
import ToastContainer from "$lib/components/shared/toast-container.svelte";

let { children } = $props();

onMount(() => {
    auth.checkAuth();
});
</script>

{@render children()}
<ToastContainer />
