<script lang="ts">
    import { invalidateAll } from "$app/navigation";
    import { formatDateTime } from "$lib/utils/date";
    import SectionShell from "$lib/components/ui/section-shell.svelte";
    import DataTable from "$lib/components/ui/data-table.svelte";
    import Button from "$lib/components/ui/button.svelte";
    import Sheet from "$lib/components/ui/sheet.svelte";

    export let data;

    let loading = false;
    let selectedLog: any = null;
    let showSheet = false;

    async function refresh() {
        loading = true;
        await invalidateAll();
        loading = false;
    }

    function openDetails(log: any) {
        selectedLog = log;
        showSheet = true;
    }

    function closeDetails() {
        showSheet = false;
        setTimeout(() => {
            selectedLog = null;
        }, 300); // Wait for animation
    }

    const columns = [
        {
            header: "Estado",
            class: "w-16 text-center",
            render: (item: any) => {
                const color =
                    item.status === "success"
                        ? "bg-emerald-500"
                        : item.status === "error"
                          ? "bg-red-500"
                          : "bg-blue-400";
                const pulse = item.status === "error" ? "animate-pulse" : "";
                return `<div class="w-2.5 h-2.5 rounded-full ${color} ${pulse} mx-auto" title="${item.status}"></div>`;
            },
        },
        {
            header: "Hora",
            render: (item: any) =>
                `<span class="text-ink-500 whitespace-nowrap">${formatDateTime(item.timestamp)}</span>`,
        },
        {
            header: "Fuente",
            render: (item: any) =>
                `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                    item.source === "llm"
                        ? "bg-purple-100 text-purple-800"
                        : "bg-gray-100 text-gray-800"
                }">${item.source.toUpperCase()}</span>`,
        },
        {
            header: "Evento",
            key: "event" as const,
            class: "font-mono text-xs text-ink-700",
        },
        {
            header: "Resumen",
            render: (item: any) =>
                `<span class="text-ink-600 truncate max-w-md block" title="${item.summary}">${item.summary}</span>`,
        },
        {
            header: "Actor",
            key: "actor" as const,
            class: "text-ink-500",
        },
    ];
</script>

<SectionShell
    title="Actividad del sistema"
    description="Línea de tiempo unificada de operaciones de IA, eventos del sistema y auditoría."
    action={refreshAction}
>
    <DataTable
        data={data.logs}
        {columns}
        {loading}
        onRowClick={openDetails}
        emptyMessage="No se encontraron registros."
    />
</SectionShell>

<Sheet
    open={showSheet}
    onclose={closeDetails}
    title={selectedLog?.event || "Detalles del registro"}
    description={selectedLog?.timestamp
        ? formatDateTime(selectedLog.timestamp)
        : ""}
>
    {#if selectedLog}
        <div class="space-y-6">
            <!-- Meta block -->
            <div class="grid grid-cols-2 gap-4 text-sm bg-cream-50 p-4 rounded border border-ink-100">
                <div>
                    <span class="block text-xs uppercase text-ink-400 mb-1">
                        Fuente
                    </span>
                    <span class="font-medium text-ink-900">
                        {selectedLog.source.toUpperCase()}
                    </span>
                </div>
                <div>
                    <span class="block text-xs uppercase text-ink-400 mb-1">
                        Status
                    </span>
                    <span
                        class="font-medium {selectedLog.status === 'error'
                            ? 'text-red-600'
                            : 'text-emerald-600'}"
                    >
                        {selectedLog.status.toUpperCase()}
                    </span>
                </div>
                <div>
                    <span class="block text-xs uppercase text-ink-400 mb-1">
                        Actor
                    </span>
                    <span class="font-medium text-ink-900">
                        {selectedLog.actor}
                    </span>
                </div>
                <div>
                    <span class="block text-xs uppercase text-ink-400 mb-1">
                        ID
                    </span>
                    <span class="font-mono text-xs text-ink-500 truncate block">
                        {selectedLog.id}
                    </span>
                </div>
            </div>

            <!-- LLM specific view -->
            {#if selectedLog.source === "llm"}
                {#if selectedLog.original_data.error_message}
                    <div class="border-l-4 border-red-500 pl-4 py-2 bg-red-50">
                        <h4 class="text-red-800 font-bold text-sm">Error</h4>
                        <p class="text-red-700 text-sm mt-1">
                            {selectedLog.original_data.error_message}
                        </p>
                    </div>
                {/if}

                <div>
                    <h4 class="font-sans text-xs uppercase tracking-widest text-ink-400 mb-2">
                        Prompt
                    </h4>
                    <div class="bg-white border border-ink-200 p-3 rounded overflow-x-auto">
                        <pre class="font-mono text-xs text-ink-600 whitespace-pre-wrap">
                            {selectedLog.original_data.prompt}
                        </pre>
                    </div>
                </div>

                <div>
                    <h4 class="font-sans text-xs uppercase tracking-widest text-ink-400 mb-2">
                        Respuesta
                    </h4>
                    <div class="bg-white border border-ink-200 p-3 rounded overflow-x-auto">
                        <pre class="font-mono text-xs text-ink-600 whitespace-pre-wrap">
                          {selectedLog.original_data.response || "Sin respuesta"}
                        </pre>
                    </div>
                </div>
            {/if}

            <!-- Generic metadata view -->
            {#if Object.keys(selectedLog.metadata).length > 0}
                <div>
                    <h4 class="font-sans text-xs uppercase tracking-widest text-ink-400 mb-2">
                        Metadata
                    </h4>
                    <div class="bg-white border border-ink-200 p-3 rounded overflow-x-auto">
                        <pre class="font-mono text-xs text-ink-500 whitespace-pre-wrap">
                          {JSON.stringify(selectedLog.metadata, null, 2)}
                        </pre>
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</Sheet>

{#snippet refreshAction()}
    <Button variant="secondary" onclick={refresh} disabled={loading}>
        {#if loading}
            Actualizando...
        {:else}
            Actualizar
        {/if}
    </Button>
{/snippet}
