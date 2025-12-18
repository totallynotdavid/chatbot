<script lang="ts">
    import { user } from '$lib/state.svelte';
    import { goto } from '$app/navigation';
    
    let username = $state('');
    let password = $state('');
    let error = $state('');

    async function submit() {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        if (res.ok) {
            const data = await res.json();
            user.data = data.user;
            user.isAuthenticated = true;
            goto('/catalog');
        } else {
            error = 'Invalid Credentials';
        }
    }
</script>

<div class="h-screen flex items-center justify-center bg-gray-100">
    <div class="bg-white p-8 rounded shadow w-96">
        <h1 class="text-xl mb-4 font-bold">Consola de administración: Bot 1</h1>
        <input bind:value={username} placeholder="Usuario" class="w-full mb-3 p-2 border rounded" />
        <input type="password" bind:value={password} placeholder="Contraseña" class="w-full mb-3 p-2 border rounded" />
        {#if error}<p class="text-red-500 mb-3">{error}</p>{/if}
        <button onclick={submit} class="w-full bg-blue-600 text-white p-2 rounded">Iniciar sesión</button>
    </div>
</div>
