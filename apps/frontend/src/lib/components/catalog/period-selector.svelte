<script lang="ts">
import type { CatalogPeriod } from "@vendeya/types";

type Props = {
  periods: CatalogPeriod[];
  selected: CatalogPeriod | null;
  onSelect: (period: CatalogPeriod) => void;
};

let { periods, selected, onSelect }: Props = $props();

function getStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Borrador";
    case "active":
      return "Activo";
    case "archived":
      return "Archivado";
    default:
      return status;
  }
}
</script>

<div class="relative">
  <select
    class="appearance-none bg-white border border-ink-200 px-4 py-2 pr-10 text-sm focus:outline-none focus:border-ink-400 cursor-pointer"
    value={selected?.id || ""}
    onchange={(e) => {
      const period = periods.find(p => p.id === e.currentTarget.value);
      if (period) onSelect(period);
    }}
  >
    {#each periods as period}
      <option value={period.id}>
        {period.name} ({getStatusLabel(period.status)})
      </option>
    {/each}
  </select>
</div>
