<script lang="ts">
import type { Product } from "@totem/types";

type Props = {
  products: Product[];
  canEdit: boolean;
  onProductClick?: (product: Product) => void;
};

let { products, canEdit, onProductClick }: Props = $props();
</script>

<div class="overflow-x-auto border border-ink-200 rounded-lg">
  <table class="w-full text-sm text-left">
    <thead class="bg-ink-50 text-ink-500 uppercase font-bold text-xs">
      <tr>
        <th class="px-4 py-3">Nombre</th>
        <th class="px-4 py-3">Categoría</th>
        <th class="px-4 py-3">Marca / Modelo</th>
        <th class="px-4 py-3">Specs</th>
        <th class="px-4 py-3">ID</th>
      </tr>
    </thead>
    <tbody class="divide-y divide-ink-100 bg-white">
      {#each products as product (product.id)}
        <tr 
          class="hover:bg-cream-50 transition-colors {canEdit ? 'cursor-pointer' : ''}"
          onclick={() => canEdit && onProductClick?.(product)}
        >
          <td class="px-4 py-3 font-medium text-ink-900">{product.name}</td>
          <td class="px-4 py-3">
            <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-800">
              {product.category}
            </span>
          </td>
          <td class="px-4 py-3 text-ink-500">
            {product.brand || "-"} {product.model ? `/ ${product.model}` : ""}
          </td>
          <td class="px-4 py-3 text-ink-400 font-mono text-xs max-w-xs truncate">
            {product.specs_json ? product.specs_json : "-"}
          </td>
          <td class="px-4 py-3 text-ink-300 font-mono text-xs">{product.id}</td>
        </tr>
      {/each}
      {#if products.length === 0}
        <tr>
          <td colspan="5" class="px-4 py-8 text-center text-ink-400 italic">
            No hay productos base registrados.
          </td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>
