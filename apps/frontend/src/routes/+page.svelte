<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { auth } from "$lib/state/auth.svelte";

onMount(async () => {
    await auth.checkAuth();

    if (auth.isAuthenticated) {
        goto("/dashboard");
    } else {
        goto("/login");
    }
});
</script>

<div class="h-screen flex items-center justify-center bg-cream-100">
	<p class="font-serif text-ink-400 italic">Cargando...</p>
</div>
