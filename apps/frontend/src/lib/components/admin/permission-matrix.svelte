<script lang="ts">
type Props = {
  role: string;
};

let { role }: Props = $props();

const permissions: Record<string, { label: string; included: boolean }[]> = {
  admin: [
    { label: "Acceso total al sistema", included: true },
    { label: "Gestión de usuarios", included: true },
    { label: "Ver logs de auditoría", included: true },
    { label: "Configuración global", included: true },
    { label: "Aprobar órdenes (nivel Calidda)", included: true },
    { label: "Simulador de pruebas", included: true },
  ],
  developer: [
    { label: "Gestión de usuarios", included: false },
    { label: "Ver logs de auditoría", included: true },
    { label: "Configuración técnica", included: true },
    { label: "Simulador de pruebas", included: true },
    { label: "Editar catálogo", included: true },
  ],
  supervisor: [
    { label: "Gestión de usuarios", included: false },
    { label: "Aprobar órdenes (Nivel Supervisor)", included: true },
    { label: "Marcar órdenes como entregadas", included: true },
    { label: "Editar catálogo", included: true },
    { label: "Ver reportes y métricas", included: true },
    { label: "Simulador de pruebas", included: false },
  ],
  sales_agent: [
    { label: "Atención de conversaciones", included: true },
    { label: "Ver catálogo (solo lectura)", included: true },
    { label: "Ver órdenes asignadas", included: true },
    { label: "Acceso a reportes", included: false },
    { label: "Modificar inventario", included: false },
  ],
};

const currentPermissions = $derived(permissions[role] || []);
</script>

<div class="bg-gray-50 border border-gray-200 rounded-lg p-4 mt-2">
  <p class="text-xs font-bold uppercase tracking-widest text-ink-400 mb-3">
    Capacidades del rol: <span class="inline-flex items-center px-2 py-0.5 bg-ink-100 text-ink-800 border border-ink-200 text-[10px] font-bold tracking-wider rounded">{role}</span>
  </p>
  <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
    {#each currentPermissions as perm}
      <div class="flex items-center gap-2 text-sm">
        {#if perm.included}
          <span class="text-green-600">✓</span>
          <span class="text-ink-900">{perm.label}</span>
        {:else}
          <span class="text-gray-400">×</span>
          <span class="text-gray-500 line-through">{perm.label}</span>
        {/if}
      </div>
    {/each}
  </div>
</div>
