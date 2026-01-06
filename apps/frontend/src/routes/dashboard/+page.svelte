<script lang="ts">
import { auth } from "$lib/state/auth.svelte";
import DashboardGridItem from "$lib/components/shared/dashboard-grid-item.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();
</script>

<PageTitle title="Dashboard" />

<div class="min-h-screen w-full flex flex-col md:flex-row bg-cream-100 md:h-screen md:overflow-hidden">
	<div class="w-full md:w-1/3 lg:w-1/4 bg-cream-50 border-b md:border-b-0 md:border-r border-ink-900/10 p-12 flex flex-col justify-between">
		<div>
			<h1 class="text-5xl font-serif mb-6 italic">totem</h1>
			<p class="text-lg text-ink-600 font-serif leading-relaxed">
				Bienvenido, {data.user?.name || data.user?.username}.<br />
				Seleccione un módulo operativo para comenzar su sesión.
			</p>
		</div>

		{#if data.user}
			<div class="hidden md:block">
				<div class="border-t border-ink-900/10 pt-6 mb-6">
					<p class="text-xs uppercase tracking-widest text-ink-400 mb-2 font-bold">
						Estado del sistema
					</p>
					<div class="flex items-center gap-2">
						<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
						<span class="text-sm font-mono text-ink-600">Operativo</span>
					</div>
				</div>

				{#if auth.isSalesAgent}
					<div class="border-t border-ink-900/10 pt-6 mb-6">
						<p class="text-xs uppercase tracking-widest text-ink-400 mb-2 font-bold">
							Tu disponibilidad
						</p>
						<button
							onclick={() => auth.toggleAvailability()}
							class="flex items-center gap-2 w-full px-3 py-2 border border-ink-200 hover:border-ink-900 transition-colors"
						>
							<span class="w-2 h-2 rounded-full {auth.isAvailable ? 'bg-green-500' : 'bg-gray-400'}"></span>
							<span class="text-sm font-mono">
								{auth.isAvailable ? 'Disponible' : 'No disponible'}
							</span>
						</button>
						<p class="text-xs text-ink-400 mt-2">
							{auth.isAvailable ? 'Recibirás nuevas asignaciones' : 'No recibirás nuevas asignaciones'}
						</p>
					</div>
				{/if}

				<button onclick={() => auth.logout()} class="text-sm hover:underline text-ink-400">
					Cerrar sesión
				</button>
			</div>
		{/if}
	</div>

	<div class="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 auto-rows-fr md:overflow-hidden">
		<DashboardGridItem
			href="/dashboard/conversations"
			number="01"
			category="Interacción"
			title="Conversaciones"
		/>
		<DashboardGridItem
			href="/dashboard/catalog"
			number="02"
			category="Inventario"
			title="Catálogo"
		/>
		<DashboardGridItem
			href="/dashboard/providers"
			number="03"
			category="Riesgo & Crédito"
			title="Proveedores"
		/>

		{#if auth.canAccessSimulator}
			<DashboardGridItem
				href="/dashboard/simulator"
				number="04"
				category="Entorno de pruebas"
				title="Simulador"
			/>
		{:else}
			<div class="bg-cream-100 p-12 border-b border-r border-ink-900/10 flex items-center justify-center opacity-50 cursor-not-allowed">
				<span class="font-mono text-xs text-ink-400">ACCESO RESTRINGIDO</span>
			</div>
		{/if}

		{#if auth.canAccessReports}
			<DashboardGridItem
				href="/dashboard/stats"
				number="05"
				category="Métricas"
				title="Analytics"
			/>
			<DashboardGridItem
				href="/dashboard/reports"
				number="06"
				category="Exportación"
				title="Reportes"
			/>
		{:else}
			<div class="bg-cream-100 p-12 border-b border-r border-ink-900/10 flex items-center justify-center opacity-50 cursor-not-allowed">
				<span class="font-mono text-xs text-ink-400">ACCESO RESTRINGIDO</span>
			</div>
			<div class="bg-cream-100 p-12 border-b border-r border-ink-900/10 flex items-center justify-center opacity-50 cursor-not-allowed">
				<span class="font-mono text-xs text-ink-400">ACCESO RESTRINGIDO</span>
			</div>
		{/if}

		<DashboardGridItem
			href="/dashboard/orders"
			number="07"
			category="Operaciones"
			title="Órdenes"
		/>

		{#if auth.isAdmin}
			<DashboardGridItem
				href="/dashboard/admin/users"
				number="08"
				category="Configuración"
				title="Administración"
				variant="dark"
			/>
		{:else}
			<div class="bg-cream-100 p-12 border-b border-r border-ink-900/10 flex items-center justify-center opacity-50 cursor-not-allowed">
				<span class="font-mono text-xs text-ink-400">ACCESO RESTRINGIDO</span>
			</div>
		{/if}
	</div>
</div>
