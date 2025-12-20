<script lang="ts">
import { onMount } from "svelte";
import { goto } from "$app/navigation";
import { auth } from "$lib/state/auth.svelte";
import FormField from "$lib/components/ui/form-field.svelte";
import Input from "$lib/components/ui/input.svelte";
import Button from "$lib/components/ui/button.svelte";
import { fetchApi } from "$lib/utils/api";

let username = $state("");
let password = $state("");
let error = $state("");
let loading = $state(false);

async function handleSubmit() {
    if (!(username && password)) {
        error = "Usuario y contraseña son requeridos";
        return;
    }

    loading = true;
    error = "";

    try {
        const data = await fetchApi<{ user: any }>("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });

        await auth.checkAuth();
        goto("/dashboard");
    } catch {
        error = "Credenciales no válidas";
    } finally {
        loading = false;
    }
}

onMount(async () => {
    await auth.checkAuth();
    if (auth.isAuthenticated) {
        goto("/dashboard");
    }
});
</script>

<div class="h-screen flex flex-col items-center justify-center bg-cream-100 p-8">
	<div class="w-full max-w-md bg-cream-50 p-12 border border-cream-200 shadow-xl">
		<h1 class="text-6xl font-serif mb-4 italic text-ink-900">totem</h1>
		<p class="text-ink-600 mb-12 font-serif text-lg leading-relaxed">
			Plataforma de gestión interna y control de operaciones.
		</p>

		<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="space-y-2">
			<FormField label="Identificador" for="username">
				<Input
					id="username"
					bind:value={username}
					disabled={loading}
					placeholder="agente_01"
				/>
			</FormField>

			<FormField label="Clave de acceso" for="password">
				<Input
					id="password"
					type="password"
					bind:value={password}
					disabled={loading}
				/>
			</FormField>

			{#if error}
				<div class="py-4">
					<p class="text-red-700 text-sm font-serif italic border-l-2 border-red-600 pl-3">
						{error}
					</p>
				</div>
			{/if}

			<Button type="submit" disabled={loading} class="w-full mt-8">
				{loading ? "Verificando..." : "Acceder"}
			</Button>
		</form>
	</div>

	<div class="mt-12 text-center text-xs text-ink-400 font-mono">
		SISTEMA DE USO INTERNO
	</div>
</div>
