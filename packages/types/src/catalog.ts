import type { StockStatus } from "./index.ts";

/** Category group for progressive disclosure */
export type CategoryGroup = "tecnología" | "hogar" | "combos";

/** Product category configuration */
export type CategoryConfig = {
  key: string;
  display: string;
  aliases: string[];
  brands: string[];
  group: CategoryGroup;
};

/** Canonical product categories */
export const CATEGORIES = {
  celulares: {
    key: "celulares",
    display: "Celulares",
    aliases: ["celular", "smartphone", "celu", "telefono", "phone", "movil"],
    brands: [
      "iphone",
      "samsung",
      "galaxy",
      "xiaomi",
      "redmi",
      "motorola",
      "huawei",
    ],
    group: "tecnología" as const,
  },
  cocinas: {
    key: "cocinas",
    display: "Cocinas",
    aliases: ["cocina", "cocineta"],
    brands: [],
    group: "hogar" as const,
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
    group: "tecnología" as const,
  },
  refrigeradoras: {
    key: "refrigeradoras",
    display: "Refrigeradoras",
    aliases: ["refrigeradora", "refri", "refrigerador", "heladera"],
    brands: ["lg", "samsung", "mabe"],
    group: "hogar" as const,
  },
  lavadoras: {
    key: "lavadoras",
    display: "Lavadoras",
    aliases: ["lavadora", "lava"],
    brands: ["lg", "samsung", "mabe"],
    group: "hogar" as const,
  },
  termas: {
    key: "termas",
    display: "Termas",
    aliases: ["terma", "calentador", "calentadora"],
    brands: [],
    group: "hogar" as const,
  },
  fusion: {
    key: "fusion",
    display: "Combos",
    aliases: ["combo", "combos", "paquete", "bundle"],
    brands: [],
    group: "combos" as const,
  },
  audio: {
    key: "audio",
    display: "Parlantes y Torres de Sonido",
    aliases: [
      "audio",
      "parlante",
      "parlantes",
      "sonido",
      "torre",
      "torres",
      "barra",
      "barras",
      "equipo de sonido",
      "torre de sonido",
      "torres de sonido",
      "barra de sonido",
    ],
    brands: ["samsung", "lg", "sony", "jbl"],
    group: "tecnología" as const,
  },
  laptops: {
    key: "laptops",
    display: "Laptops",
    aliases: ["laptop", "computadora", "notebook", "portátil", "pc"],
    brands: ["lenovo", "hp", "acer", "dell", "asus"],
    group: "tecnología" as const,
  },
  pequeños: {
    key: "pequeños",
    display: "Pequeños Electrodomésticos",
    aliases: ["licuadora", "exprimidor", "pequeño", "pequeños"],
    brands: [],
    group: "hogar" as const,
  },
} as const satisfies Record<string, CategoryConfig>;

export type CategoryKey = keyof typeof CATEGORIES;

export const CATEGORY_GROUPS = {
  tecnología: {
    key: "tecnología",
    display: "Tecnología",
    description: "celulares, laptops, parlantes, televisores",
    categories: ["celulares", "laptops", "audio", "tv"] as const,
  },
  hogar: {
    key: "hogar",
    display: "Línea blanca y hogar",
    description: "lavadoras, refrigeradoras, cocinas, termas, pequeños",
    categories: [
      "lavadoras",
      "refrigeradoras",
      "cocinas",
      "termas",
      "pequeños",
    ] as const,
  },
  combos: {
    key: "combos",
    display: "Combos",
    description: "paquetes promocionales",
    categories: ["fusion"] as const,
  },
} as const;

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

/** Bundles are promotional packages */
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
