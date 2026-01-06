<script lang="ts" generics="T extends Record<string, any>">
type Column<T> = {
  header: string;
  key?: keyof T;
  render?: (item: T) => string | any;
  class?: string;
  align?: "left" | "center" | "right";
};

type Props<T> = {
  data: T[];
  columns: Column<T>[];
  keyField?: keyof T;
  emptyMessage?: string;
  loading?: boolean;
  onRowClick?: (item: T) => void;
};

let {
  data,
  columns,
  keyField = "id" as keyof T,
  emptyMessage = "No hay datos disponibles",
  loading = false,
  onRowClick,
}: Props<T> = $props();
</script>

<div class="overflow-x-auto">
    <table class="w-full text-sm text-left">
        <thead class="bg-cream-50 font-mono text-xs uppercase tracking-wider text-ink-500 border-b border-ink-100">
            <tr>
                {#each columns as col}
                    <th 
                        class="px-6 py-4 font-bold select-none whitespace-nowrap {col.class || ''} text-{col.align || 'left'}"
                    >
                        {col.header}
                    </th>
                {/each}
            </tr>
        </thead>
        <tbody class="divide-y divide-ink-50 bg-white">
            {#if loading}
                {#each Array(3) as _}
                    <tr class="animate-pulse">
                        {#each columns as _col}
                            <td class="px-6 py-4">
                                <div class="h-4 bg-cream-100 rounded w-2/3"></div>
                            </td>
                        {/each}
                    </tr>
                {/each}
            {:else if data.length === 0}
                <tr>
                    <td colspan={columns.length} class="px-6 py-12 text-center text-ink-400 italic">
                        {emptyMessage}
                    </td>
                </tr>
            {:else}
                {#each data as item (item[keyField])}
                    <tr 
                        class="group transition-colors hover:bg-cream-50/50 {onRowClick ? 'cursor-pointer' : ''}"
                        onclick={() => onRowClick?.(item)}
                    >
                        {#each columns as col}
                            <td class="px-6 py-4 relative {col.class || ''} text-{col.align || 'left'}">
                                {#if col.render}
                                    {@html col.render(item)}
                                {:else if col.key}
                                     <!-- Default: treat as string -->
                                     {item[col.key]}
                                {/if}
                            </td>
                        {/each}
                    </tr>
                {/each}
            {/if}
        </tbody>
    </table>
</div>
