<script lang="ts">
import { onMount } from "svelte";
import { user } from "$lib/state.svelte";

onMount(async () => {
    if (!user.isAuthenticated) {
        window.location.href = "/login";
    }
});
</script>

<div class="h-screen w-full flex flex-col md:flex-row bg-cream-100 overflow-hidden">
    <div class="w-full md:w-1/3 lg:w-1/4 bg-cream-50 border-b md:border-b-0 md:border-r border-ink-900/10 p-12 flex flex-col justify-between">
        <div>
            <h1 class="text-5xl font-serif mb-6 italic">totem</h1>
            <p class="text-lg text-ink-600 font-serif leading-relaxed">
                Bienvenido, {user.data?.username}.<br>
                Seleccione un módulo operativo para comenzar su sesión.
            </p>
        </div>
        
        {#if user.data}
            <div class="hidden md:block">
                <div class="border-t border-ink-900/10 pt-6 mb-6">
                    <p class="text-xs uppercase tracking-widest text-ink-400 mb-2 font-bold">Estado del sistema</p>
                    <div class="flex items-center gap-2">
                        <span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                        <span class="text-sm font-mono text-ink-600">Operativo</span>
                    </div>
                </div>
                <button onclick={() => user.logout()} class="text-sm hover:underline text-ink-400">
                    Cerrar sesión actual
                </button>
            </div>
        {/if}
    </div>

    <!-- Grid navigation -->
    <div class="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 auto-rows-fr">
        <a href="/conversations" class="group border-b border-r border-ink-900/10 p-12 hover:bg-white transition-all flex flex-col justify-between relative overflow-hidden">
            <span class="text-6xl font-serif text-cream-300 group-hover:text-ink-100 transition-colors absolute top-4 right-4 z-0">01</span>
            <div class="relative z-10 mt-auto">
                <span class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2 block">Interacción</span>
                <h2 class="text-3xl font-serif group-hover:underline underline-offset-4 decoration-1">Conversaciones</h2>
            </div>
        </a>

        <a href="/catalog" class="group border-b border-r border-ink-900/10 p-12 hover:bg-white transition-all flex flex-col justify-between relative overflow-hidden">
            <span class="text-6xl font-serif text-cream-300 group-hover:text-ink-100 transition-colors absolute top-4 right-4 z-0">02</span>
            <div class="relative z-10 mt-auto">
                <span class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2 block">Inventario</span>
                <h2 class="text-3xl font-serif group-hover:underline underline-offset-4 decoration-1">Catálogo</h2>
            </div>
        </a>

        <a href="/providers" class="group border-b border-r border-ink-900/10 p-12 hover:bg-white transition-all flex flex-col justify-between relative overflow-hidden">
            <span class="text-6xl font-serif text-cream-300 group-hover:text-ink-100 transition-colors absolute top-4 right-4 z-0">03</span>
            <div class="relative z-10 mt-auto">
                <span class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-2 block">Riesgo & Crédito</span>
                <h2 class="text-3xl font-serif group-hover:underline underline-offset-4 decoration-1">Proveedores</h2>
            </div>
        </a>

        {#if user.data?.role === 'admin'}
            <a href="/admin" class="group border-b border-r border-ink-900/10 p-12 hover:bg-ink-900 transition-all flex flex-col justify-between relative overflow-hidden">
                <span class="text-6xl font-serif text-cream-300 group-hover:text-ink-800 transition-colors absolute top-4 right-4 z-0">04</span>
                <div class="relative z-10 mt-auto">
                    <span class="text-xs font-bold uppercase tracking-widest text-ink-400 group-hover:text-ink-500 mb-2 block">Configuración</span>
                    <h2 class="text-3xl font-serif text-ink-900 group-hover:text-cream-50 group-hover:underline underline-offset-4 decoration-1">Administración</h2>
                </div>
            </a>
        {:else}
            <div class="bg-cream-100 p-12 border-b border-r border-ink-900/10 flex items-center justify-center opacity-50 cursor-not-allowed">
                <span class="font-mono text-xs text-ink-400">ACCESO RESTRINGIDO</span>
            </div>
        {/if}
    </div>
</div>
