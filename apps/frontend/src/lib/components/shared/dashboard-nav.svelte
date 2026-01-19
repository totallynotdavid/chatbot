<script lang="ts">
  import { page } from "$app/state";
  import { auth } from "$lib/state/auth.svelte";

  const breadcrumbLabels: Record<string, string> = {
    "/dashboard/conversations": "Conversaciones",
    "/dashboard/catalog": "Catálogo",
    "/dashboard/providers": "Proveedores",
    "/dashboard/simulator": "Simulador",
    "/dashboard/activity": "Actividad del sistema",
    "/dashboard/reports": "Reportes",
    "/dashboard/orders": "Órdenes",
    "/dashboard/admin": "Administración",
    "/dashboard/admin/users": "Usuarios",
    "/dashboard/admin/users/create": "Nuevo usuario",
    "/dashboard/admin/periods": "Periodos",
    "/dashboard/admin/audit": "Auditoría",
    "/dashboard/admin/settings": "Configuración",
    "/dashboard/personas": "Personas",
    "/dashboard/personas/create": "Crear",
  };

  $: crumbs = (() => {
    const path = page.url.pathname;
    const segments = path.split("/").filter(Boolean);
    let currentPath = "";
    const trail: { label: string; href: string }[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      currentPath += `/${segment}`;

      // Check for static label first
      let label = breadcrumbLabels[currentPath];

      // For conversation detail pages, use phone number or client name from page data
      if (
        !label &&
        segments[i - 1] === "conversations" &&
        segment?.startsWith("+")
      ) {
        const pageData = page.data as any;
        label = pageData?.conversation?.client_name || segment;
      }

      if (label) {
        trail.push({
          label,
          href:
            currentPath === "/dashboard/admin"
              ? "/dashboard/admin/users"
              : currentPath,
        });
      }
    }
    return trail;
  })();
</script>

<nav
  class="border-b border-ink-900/10 bg-cream-50 px-8 py-4 flex justify-between items-center sticky top-0 z-50"
>
  <div class="flex items-baseline gap-2 group">
    <a
      href="/dashboard"
      class="font-serif font-bold italic text-xl hover:text-ink-600 transition-colors"
    >
      totem
    </a>
    {#each crumbs as crumb, i}
      <span class="text-ink-400 text-sm">/</span>
      {#if i === crumbs.length - 1}
        <span class="text-xs uppercase tracking-widest font-bold text-ink-400">
          {crumb.label}
        </span>
      {:else}
        <a
          href={crumb.href}
          class="text-xs uppercase tracking-widest font-bold text-ink-400 hover:text-ink-900 transition-colors"
        >
          {crumb.label}
        </a>
      {/if}
    {/each}
  </div>

  <div class="flex items-center gap-6 text-xs font-mono">
    <span class="text-ink-600">
      {auth.user?.name || auth.user?.username} ({auth.user?.role})
    </span>
    <button onclick={() => auth.logout()} class="hover:underline text-red-600">
      Salir
    </button>
  </div>
</nav>
