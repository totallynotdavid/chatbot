<script lang="ts">
import type { Bundle } from "@totem/types";
import { formatPrice } from "$lib/utils/formatters";
import StockBadge from "./stock-badge.svelte";

type Props = {
  bundles: Bundle[];
  canEdit: boolean;
  onBundleClick?: (bundle: Bundle) => void;
  onStockUpdate: (bundleId: string, status: any) => void;
};

let { bundles, canEdit, onBundleClick, onStockUpdate }: Props = $props();

function getCompositionCount(json: string): number {
  try {
    const comp = JSON.parse(json);
    const fixedCount = comp.fixed?.length || 0;
    const choiceCount = comp.choices ? comp.choices.reduce((acc: number, c: any) => acc + c.pick, 0) : 0;
    return fixedCount + choiceCount;
  } catch {
    return 0;
  }
}

function getInstallmentsText(json: string): string {
    try {
        const sched = JSON.parse(json);
        if (Array.isArray(sched) && sched.length > 0) {
            return `${sched[0].months} cuotas`;
        }
    } catch {}
    return "";
}
</script>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
  {#each bundles as bundle (bundle.id)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="group flex flex-col h-full bg-white hover:bg-cream-50 p-4 transition-all duration-300 border border-transparent hover:border-emerald-200 shadow-sm hover:shadow-md rounded-lg {canEdit ? 'cursor-pointer' : ''}"
      onclick={() => canEdit && onBundleClick?.(bundle)}
    >
      <div class="aspect-video w-full bg-white mb-3 overflow-hidden relative rounded-md border border-ink-900/5">
        <img
          src="/static/images/{bundle.image_id}.jpg"
          alt={bundle.name}
          class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
          onerror={(e) => {
            const target = e.currentTarget;
            if (target instanceof HTMLImageElement) {
              target.src = "/placeholder.svg";
            }
          }}
        />
        {#if bundle.is_active === 0}
          <div class="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center">
            <span class="text-ink-400 font-bold uppercase text-xs tracking-wider border border-ink-200 px-2 py-1">
              Inactivo
            </span>
          </div>
        {/if}
        <div class="absolute bottom-2 left-2">
            <span class="bg-emerald-600 text-white text-xs font-bold px-2 py-1 rounded-sm shadow-sm">
                S/ {formatPrice(bundle.price)}
            </span>
        </div>
      </div>

      <div class="flex justify-between items-start mb-2">
         <h3 class="font-serif text-lg leading-tight text-ink-900 line-clamp-2">
          {bundle.name}
        </h3>
      </div>
      
       <div class="flex justify-between items-center mb-3">
        <span class="text-[10px] font-bold uppercase tracking-widest text-ink-400">
          {bundle.primary_category}
        </span>
        <div onclick={(e) => e.stopPropagation()} role="presentation">
             <!-- Reuse StockBadge but adapt props if needed -->
             <StockBadge
                productId={bundle.id}
                productName={bundle.name}
                stockStatus={bundle.stock_status}
                canEdit={canEdit}
                onUpdate={(s) => onStockUpdate(bundle.id, s)}
            />
        </div>
      </div>

      <div class="mt-auto pt-3 border-t border-ink-900/5 flex flex-col gap-1 text-xs text-ink-500">
        <div class="flex items-center gap-2">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path></svg>
            <span>{getCompositionCount(bundle.composition_json)} piezas incluidas</span>
        </div>
         <div class="flex items-center gap-2">
            <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            <span>{getInstallmentsText(bundle.installments_json)}</span>
        </div>
      </div>
    </div>
  {/each}
</div>
