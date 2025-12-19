<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";
import { goto } from "$app/navigation";

onMount(async () => {
    await user.checkAuth();

    if (user.isAuthenticated) {
        goto("/dashboard");
    } else {
        goto("/login");
    }
});
</script>

<div class="h-screen flex items-center justify-center bg-cream-100">
  <p class="font-serif text-ink-400 italic">Cargando...</p>
</div>
