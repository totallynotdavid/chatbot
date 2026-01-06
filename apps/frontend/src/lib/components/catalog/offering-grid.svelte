<script lang="ts">
import type { FnbOffering } from "@totem/types";
import { formatPrice } from "$lib/utils/formatters";
import StockBadge from "./stock-badge.svelte";

type Props = {
  offerings: FnbOffering[];
  canEdit: boolean;
  onOfferingClick?: (offering: FnbOffering) => void;
  onStockUpdate: (id: string, status: any) => void;
};

let { offerings, canEdit, onOfferingClick, onStockUpdate }: Props = $props();
</script>

<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
  {#each offerings as offering (offering.id)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="group flex flex-col h-full bg-white hover:bg-cream-50 p-4 transition-all duration-300 border border-transparent hover:border-blue-200 shadow-sm hover:shadow-md rounded-lg {canEdit ? 'cursor-pointer' : ''}"
      onclick={() => canEdit && onOfferingClick?.(offering)}
    >
      <div class="aspect-square w-full bg-white mb-3 overflow-hidden relative mix-blend-multiply border border-ink-900/5 p-2">
        <img
          src="/static/images/{offering.image_id}.jpg"
          alt="Product Img"
          class="w-full h-full object-contain transition-transform duration-500 group-hover:scale-105"
          onerror={(e) => {
            const target = e.currentTarget;
            if (target instanceof HTMLImageElement) {
              target.src = "/placeholder.svg";
            }
          }}
        />
        {#if offering.is_active === 0}
          <div class="absolute inset-0 bg-white/80 backdrop-blur-[1px] flex items-center justify-center">
            <span class="text-ink-400 font-bold uppercase text-xs tracking-wider border border-ink-200 px-2 py-1">
              Inactivo
            </span>
          </div>
        {/if}
         <div class="absolute top-0 right-0">
             <span class="bg-blue-600 text-white text-xs font-bold px-2 py-1 rounded-bl-md">
                S/ {formatPrice(offering.price)}
             </span>
        </div>
      </div>

       <div class="flex justify-between items-center mb-2">
        <span class="text-[10px] font-bold uppercase tracking-widest text-ink-400">
          {offering.category}
        </span>
        <div onclick={(e) => e.stopPropagation()} role="presentation">
             <StockBadge
                productId={offering.id}
                productName="Offering"
                stockStatus={offering.stock_status}
                canEdit={canEdit}
                onUpdate={(s) => onStockUpdate(offering.id, s)}
            />
        </div>
      </div>

      <h3 class="font-serif text-lg leading-tight text-ink-900 mb-2">
          {JSON.parse(offering.product_snapshot_json).name}
      </h3>

      <div class="mt-auto pt-3 border-t border-ink-900/5 flex justify-between items-center">
         <span class="text-xs text-ink-500">Plan FNB</span>
         {#if offering.installments}
            <span class="text-xs font-bold text-blue-600">{offering.installments} meses</span>
         {/if}
      </div>
    </div>
  {/each}
</div>
