<script lang="ts">
import { user } from "$lib/state.svelte";
import { goto } from "$app/navigation";

let username = $state("");
let password = $state("");
let error = $state("");

async function submit() {
    const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
    });

    if (res.ok) {
        const data = await res.json();
        user.data = data.user;
        user.isAuthenticated = true;
        goto("/");
    } else {
        error = "Credenciales no válidas";
    }
}
</script>

<div class="h-screen flex flex-col items-center justify-center bg-cream-100 p-8">
    <div class="w-full max-w-md bg-cream-50 p-12 border border-cream-200 shadow-xl">
        <h1 class="text-6xl font-serif mb-4 italic text-ink-900">totem</h1>
        <p class="text-ink-600 mb-12 font-serif text-lg leading-relaxed">Plataforma de gestión interna y control de operaciones.</p>

        <form onsubmit={(e) => { e.preventDefault(); submit(); }} class="space-y-2">
            <div class="input-group">
                <label for="username" class="input-label">Identificador</label>
                <input id="username" bind:value={username} type="text" class="input-field" placeholder="agente_01" autocomplete="username" />
            </div>
            
            <div class="input-group">
                <label for="password" class="input-label">Clave de acceso</label>
                <input id="password" type="password" bind:value={password} class="input-field" placeholder="••••••••" autocomplete="current-password" />
            </div>

            {#if error}
                <div class="py-4">
                    <p class="text-red-700 text-sm font-serif italic border-l-2 border-red-600 pl-3">{error}</p>
                </div>
            {/if}

            <button type="submit" class="btn-primary w-full mt-8">
                Acceder
            </button>
        </form>
    </div>
    
    <div class="mt-12 text-center text-xs text-ink-400 font-mono">
        SISTEMA DE USO INTERNO SOLAMENTE
    </div>
</div>
