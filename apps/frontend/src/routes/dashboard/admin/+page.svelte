<script lang="ts">
import PageTitle from "$lib/components/shared/page-title.svelte";
import PageHeader from "$lib/components/shared/page-header.svelte";

import UsersTab from "./users-tab.svelte";
import AuditTab from "./audit-tab.svelte";
import SettingsTab from "./settings-tab.svelte";

let activeTab = $state("users");

const tabs = [
  { id: "users", label: "Usuarios" },
  { id: "audit", label: "Auditoría" },
  { id: "settings", label: "Configuración" },
];
</script>

<PageTitle title="Administración" />

<div class="max-w-7xl mx-auto p-8 md:p-12 min-h-screen">
    <PageHeader title="Panel de Administración" subtitle="Control y Gestión" />

    <!-- Tabs -->
    <div class="flex gap-1 border-b border-cream-200 mb-8 overflow-x-auto">
        {#each tabs as tab}
            <button
                class="px-6 py-3 text-sm font-bold uppercase tracking-widest border-b-2 transition-colors whitespace-nowrap {activeTab === tab.id ? 'border-ink-900 text-ink-900' : 'border-transparent text-ink-400 hover:text-ink-600'}"
                onclick={() => activeTab = tab.id}
            >
                {tab.label}
            </button>
        {/each}
    </div>

    <!-- Content -->
    {#if activeTab === "users"}
        <UsersTab />
    {:else if activeTab === "audit"}
        <AuditTab />
    {:else if activeTab === "settings"}
        <SettingsTab />
    {/if}
</div>
