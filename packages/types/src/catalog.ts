import type { StockStatus } from "./index.ts";

/** Product category configuration */
export type CategoryConfig = {
  key: string;
  display: string;
  aliases: string[];
  brands: string[];
};

/** Canonical product categories */
export const CATEGORIES = {
  celulares: {
    key: "celulares",
    display: "Celulares",
    aliases: ["celular", "smartphone", "celu", "telefono", "phone", "movil"],
    brands: ["iphone", "samsung", "xiaomi", "redmi", "motorola"],
  },
  cocinas: {
    key: "cocinas",
    display: "Cocinas",
    aliases: ["cocina", "cocineta"],
    brands: [],
  },
  tv: {
    key: "tv",
    display: "Televisores",
    aliases: [
      "televisor",
      "televisores",
      "television",
      "tele",
      "pantalla",
      "smart tv",
    ],
    brands: ["lg", "samsung", "sony", "hisense", "jvc"],
  },
  refrigeradoras: {
    key: "refrigeradoras",
    display: "Refrigeradoras",
    aliases: ["refrigeradora", "refri", "refrigerador", "heladera"],
    brands: ["lg", "samsung", "mabe"],
  },
  lavadoras: {
    key: "lavadoras",
    display: "Lavadoras",
    aliases: ["lavadora", "lava"],
    brands: ["lg", "samsung", "mabe"],
  },
  termas: {
    key: "termas",
    display: "Termas",
    aliases: ["terma", "calentador", "calentadora"],
    brands: [],
  },
  fusion: {
    key: "fusion",
    display: "Combos",
    aliases: ["combo", "combos", "paquete", "bundle"],
    brands: [],
  },
} as const satisfies Record<string, CategoryConfig>;

export type CategoryKey = keyof typeof CATEGORIES;

/** Base product template (segment-agnostic inventory) */
export type Product = {
  id: string;
  name: string;
  category: string;
  brand: string | null;
  model: string | null;
  specs_json: string | null;
  created_at: string;
};

/** Parsed product specs */
export type ProductSpecs = Record<string, string | number | boolean>;

/** Snapshotted product in bundle composition */
export type SnapshotProduct = {
  id: string;
  name: string;
  specs: ProductSpecs;
};

/** Choice option in bundle */
export type BundleChoiceOption = SnapshotProduct;

/** Choice group (e.g., "01 producto a elección") */
export type BundleChoice = {
  label: string;
  pick: number;
  options: BundleChoiceOption[];
};

/** Bundle composition (fixed items + choices) */
export type BundleComposition = {
  fixed: SnapshotProduct[];
  choices: BundleChoice[];
};

/** Installment schedule for bundles */
export type InstallmentSchedule = {
  "3m"?: number;
  "6m"?: number;
  "9m"?: number;
  "12m"?: number;
  "18m"?: number;
  "24m"?: number;
  "36m"?: number;
  "48m"?: number;
  "60m"?: number;
};

/** GASO bundle (promotional package) */
export type Bundle = {
  id: string;
  period_id: string;
  name: string;
  price: number;
  primary_category: string;
  categories_json: string | null;
  image_id: string;
  composition_json: string;
  installments_json: string;
  notes: string;
  is_active: number;
  stock_status: StockStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** FNB offering (individual product sale) */
export type FnbOffering = {
  id: string;
  period_id: string;
  product_id: string;
  product_snapshot_json: string;
  price: number;
  category: string;
  installments: number | null;
  image_id: string;
  is_active: number;
  stock_status: StockStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
