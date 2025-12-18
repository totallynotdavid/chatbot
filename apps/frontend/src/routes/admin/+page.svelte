<script lang="ts">
    import { onMount } from 'svelte';
    import { user } from '$lib/state.svelte';
    import { goto } from '$app/navigation';

    let newUsername = $state('');
    let newPassword = $state('');
    let newRole = $state('user');
    let message = $state('');

    onMount(() => {
        if (!user.isAuthenticated) {
            goto('/login');
            return;
        }
        if (user.data?.role !== 'admin') {
            goto('/');
        }
    });

    async function createUser() {
        // Mock API call - in production replace with actual fetch
        // await fetch('/api/admin/users', { ... })
        console.log('Creating user', { newUsername, newRole });
        message = `Usuario ${newUsername} creado correctamente.`;
        newUsername = '';
        newPassword = '';
    }
</script>

<div class="page-container max-w-2xl">
    <div class="module-header">
        <div>
            <span class="module-subtitle">Configuración</span>
            <h1 class="module-title">Gestión de usuarios</h1>
        </div>
    </div>

    <div class="bg-white p-8 border border-cream-200 shadow-sm">
        <h2 class="text-xl font-serif mb-6">Registrar nuevo agente</h2>
        
        <form onsubmit={(e) => { e.preventDefault(); createUser(); }} class="space-y-6">
            <div class="input-group">
                <label class="input-label">Nombre de usuario</label>
                <input bind:value={newUsername} type="text" class="input-field" placeholder="usuario_nuevo" required />
            </div>

            <div class="input-group">
                <label class="input-label">Contraseña temporal</label>
                <input bind:value={newPassword} type="password" class="input-field" placeholder="••••••••" required />
            </div>

            <div class="input-group">
                <label class="input-label">Rol de acceso</label>
                <select bind:value={newRole} class="input-select">
                    <option value="user">Agente Operativo (User)</option>
                    <option value="admin">Administrador (Admin)</option>
                </select>
            </div>

            {#if message}
                <div class="p-4 bg-green-50 text-green-800 text-sm font-serif italic border border-green-200">
                    {message}
                </div>
            {/if}

            <button type="submit" class="btn-primary w-full">
                Crear credenciales
            </button>
        </form>
    </div>
</div>
