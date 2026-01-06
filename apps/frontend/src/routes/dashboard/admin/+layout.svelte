<script lang="ts">
import { page } from "$app/stores";
import PageHeader from "$lib/components/shared/page-header.svelte";
import PageTitle from "$lib/components/shared/page-title.svelte";

let { children } = $props();

const tabs = [
    { href: "/dashboard/admin/users", label: "Usuarios" },
    { href: "/dashboard/admin/audit", label: "Auditoría" },
    { href: "/dashboard/admin/settings", label: "Configuración" },
];

function isActive(path: string) {
    const current = $page.url.pathname;
    if (path === "/dashboard/admin/users") {
        return current.includes("/dashboard/admin/users");
    }
    return current.startsWith(path);
}
</script>

<PageTitle title="Administración" />

<div class="max-w-7xl mx-auto p-8 md:p-12 min-h-screen">
    <PageHeader title="Panel de administración" subtitle="Control y gestión" />

    <div class="mb-10 border-b border-ink-100">
        <nav class="flex gap-8" aria-label="Tabs">
            {#each tabs as tab}
                <a
                    href={tab.href}
                    class="
                        py-4 text-xs font-bold uppercase tracking-widest border-b-2 transition-colors
                        {isActive(tab.href) 
                            ? 'border-ink-900 text-ink-900' 
                            : 'border-transparent text-ink-400 hover:text-ink-600 hover:border-ink-200'}
                    "
                    aria-current={isActive(tab.href) ? "page" : undefined}
                >
                    {tab.label}
                </a>
            {/each}
        </nav>
    </div>

    <!-- Content -->
    {@render children()}
</div>
