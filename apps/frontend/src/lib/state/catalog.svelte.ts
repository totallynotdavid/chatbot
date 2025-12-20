import type { Product } from "@totem/types";

function createCatalogState() {
	let selectedIds = $state<Set<string>>(new Set());

	return {
		get selectedIds() {
			return selectedIds;
		},
		get selectedCount() {
			return selectedIds.size;
		},
		toggle(id: string) {
			if (selectedIds.has(id)) {
				selectedIds.delete(id);
			} else {
				selectedIds.add(id);
			}
			selectedIds = selectedIds;
		},
		selectAll(products: Product[]) {
			selectedIds = new Set(products.map((p) => p.id));
		},
		clear() {
			selectedIds = new Set();
		},
		isSelected(id: string) {
			return selectedIds.has(id);
		},
		toggleAll(products: Product[]) {
			if (selectedIds.size === products.length) {
				this.clear();
			} else {
				this.selectAll(products);
			}
		},
	};
}

export const catalogSelection = createCatalogState();
