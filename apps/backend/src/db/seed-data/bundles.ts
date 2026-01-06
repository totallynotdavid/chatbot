import type { BundleComposition, InstallmentSchedule } from "@totem/types";
import { BASE_PRODUCTS } from "./products.ts";

/** Helper to get product snapshot from BASE_PRODUCTS */
function snap(id: string) {
  const p = BASE_PRODUCTS.find((p) => p.id === id);
  if (!p) throw new Error(`Product ${id} not found`);
  return { id: p.id, name: p.name, specs: p.specs };
}

type BundleSeed = {
  image_id: string;
  name: string;
  price: number;
  primary_category: string;
  categories: string[];
  composition: BundleComposition;
  installments: InstallmentSchedule;
};

/** GASO bundles from January 2026 catalog (sample.txt) */
export const BUNDLES_SEED: BundleSeed[] = [
  {
    image_id: "e4976160c1e346b8",
    name: "Celular a elección + Cocineta 2Q",
    price: 1799,
    primary_category: "celulares",
    categories: ["celulares", "cocinas"],
    composition: {
      fixed: [snap("cocineta_2q_gas")],
      choices: [{
        label: "01 celular a elección",
        pick: 1,
        options: [snap("xiaomi_redmi_15c"), snap("honor_x6c"), snap("samsung_a17_5g")],
      }],
    },
    installments: { "3m": 643.30, "6m": 339.58, "9m": 238.58, "12m": 188.26, "18m": 138.29 },
  },
  {
    image_id: "51c9756bdb3b4f7a",
    name: "Samsung Galaxy A56 + Cocineta 2Q",
    price: 3399,
    primary_category: "celulares",
    categories: ["celulares", "cocinas"],
    composition: {
      fixed: [snap("samsung_a56"), snap("cocineta_2q_gas")],
      choices: [],
    },
    installments: { "3m": 1215.44, "6m": 641.60, "9m": 450.77, "12m": 355.69, "18m": 261.28 },
  },
  {
    image_id: "7de286fb4a9a4f19",
    name: "Producto a elección + Cocineta 2Q",
    price: 2199,
    primary_category: "fusion",
    categories: ["celulares", "refrigeradoras", "lavadoras", "tv", "cocinas"],
    composition: {
      fixed: [snap("cocineta_2q_gas")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("samsung_a26"), snap("mabe_refri_239l"), snap("samsung_lavadora_13kg"), snap("hisense_tv_50")],
      }],
    },
    installments: { "3m": 786.33, "6m": 415.08, "9m": 291.63, "12m": 230.11, "18m": 169.04 },
  },
  {
    image_id: "71ea846b26174659",
    name: "Cocina a elección + Producto a elección",
    price: 2899,
    primary_category: "fusion",
    categories: ["cocinas", "audio", "refrigeradoras", "lavadoras", "tv"],
    composition: {
      fixed: [],
      choices: [
        { label: "01 cocina de elección", pick: 1, options: [snap("mabe_cocina_4q"), snap("miray_cocina_4q")] },
        { label: "01 producto de elección", pick: 1, options: [snap("samsung_torre_sonido"), snap("mabe_refri_187l"), snap("samsung_lavadora_13kg"), snap("hisense_tv_55")] },
      ],
    },
    installments: { "3m": 1036.64, "6m": 547.22, "9m": 384.46, "12m": 303.37, "18m": 222.84 },
  },
  {
    image_id: "1d6fdc9cbee04bc3",
    name: "Producto a elección + Cocineta 2Q",
    price: 2399,
    primary_category: "fusion",
    categories: ["tv", "audio", "cocinas"],
    composition: {
      fixed: [snap("cocineta_2q_gas")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("hisense_tv_55"), snap("lg_torre_sonido")],
      }],
    },
    installments: { "3m": 857.85, "6m": 452.84, "9m": 318.15, "12m": 251.04, "18m": 184.41 },
  },
  {
    image_id: "67d0f026be9142ff",
    name: "Cocina Mabe 4Q + Producto a elección",
    price: 2999,
    primary_category: "cocinas",
    categories: ["cocinas", "tv", "lavadoras", "refrigeradoras"],
    composition: {
      fixed: [snap("mabe_cocina_4q")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("hisense_tv_50"), snap("mabe_lavadora_9kg"), snap("mabe_refri_239l")],
      }],
    },
    installments: { "3m": 1072.40, "6m": 566.09, "9m": 397.72, "12m": 313.83, "18m": 230.53 },
  },
  {
    image_id: "77bcf7c50c054af4",
    name: "Cocineta 2Q + Refrigeradora Mabe 187L + Producto a elección",
    price: 3099,
    primary_category: "fusion",
    categories: ["cocinas", "refrigeradoras", "tv", "lavadoras"],
    composition: {
      fixed: [snap("cocineta_2q_gas"), snap("mabe_refri_187l")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("hisense_tv_50"), snap("mabe_lavadora_10kg")],
      }],
    },
    installments: { "3m": 1108.16, "6m": 584.97, "9m": 410.98, "12m": 324.30, "18m": 238.22 },
  },
  {
    image_id: "150719b93c38461e",
    name: "Producto premium a elección + Cocineta 2Q",
    price: 3499,
    primary_category: "fusion",
    categories: ["tv", "lavadoras", "cocinas"],
    composition: {
      fixed: [snap("cocineta_2q_gas")],
      choices: [{
        label: "01 producto a elección",
        pick: 1,
        options: [snap("samsung_tv_65"), snap("lg_tv_65"), snap("lavaseca_lg_samsung")],
      }],
    },
    installments: { "3m": 1251.19, "6m": 660.47, "9m": 464.03, "12m": 366.15, "18m": 268.97 },
  },
  {
    image_id: "b5e9a6deab044c42",
    name: "Cocina Mabe 4Q + Refrigerador Mabe 230L + Producto a elección",
    price: 4999,
    primary_category: "fusion",
    categories: ["cocinas", "refrigeradoras", "tv", "lavadoras"],
    composition: {
      fixed: [snap("mabe_cocina_4q"), snap("mabe_refri_230l")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("hisense_tv_55"), snap("samsung_lavadora_13kg")],
      }],
    },
    installments: { "3m": 1787.57, "6m": 943.61, "9m": 662.95, "12m": 523.12, "18m": 384.27 },
  },
  {
    image_id: "d6ce52ce24204be6",
    name: "Refrigerador grande a elección + Terma Holi 5.5L",
    price: 3999,
    primary_category: "termas",
    categories: ["refrigeradoras", "termas"],
    composition: {
      fixed: [snap("terma_holi_5_5l")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("mabe_refri_511l"), snap("lg_refri_509l"), snap("indurama_refri_508l")],
      }],
    },
    installments: { "3m": 1429.99, "6m": 754.85, "9m": 530.34, "12m": 418.48, "18m": 307.40 },
  },
  {
    image_id: "604dc5df458d4362",
    name: "Cocina 6Q a elección + Producto a elección",
    price: 3199,
    primary_category: "cocinas",
    categories: ["cocinas", "refrigeradoras", "lavadoras", "celulares"],
    composition: {
      fixed: [],
      choices: [
        { label: "01 cocina de elección 6Q", pick: 1, options: [snap("mabe_cocina_6q"), snap("indurama_cocina_6q")] },
        { label: "01 producto de elección", pick: 1, options: [snap("mabe_refri_187l"), snap("mabe_lavadora_10kg"), snap("samsung_a17_5g"), snap("honor_x6c"), snap("xiaomi_redmi_15c")] },
      ],
    },
    installments: { "3m": 1143.92, "6m": 603.84, "9m": 424.24, "12m": 334.76, "18m": 245.90 },
  },
  {
    image_id: "6ce6f405a6144625",
    name: "Producto a elección + Terma Holi 5.5L",
    price: 3299,
    primary_category: "termas",
    categories: ["tv", "lavadoras", "celulares", "termas"],
    composition: {
      fixed: [snap("terma_holi_5_5l")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("hisense_tv_55"), snap("mabe_lavadora_22kg"), snap("samsung_a35")],
      }],
    },
    installments: { "3m": 1179.68, "6m": 622.72, "9m": 437.51, "12m": 345.22, "18m": 253.59 },
  },
  {
    image_id: "99a1b24c11fa4f40",
    name: "Cocineta 2Q + Smart TV Hisense 55\" + Producto a elección",
    price: 3199,
    primary_category: "tv",
    categories: ["cocinas", "tv", "lavadoras", "celulares"],
    composition: {
      fixed: [snap("cocineta_2q_gas"), snap("hisense_tv_55")],
      choices: [{
        label: "01 producto de elección",
        pick: 1,
        options: [snap("mabe_lavadora_10kg"), snap("samsung_a17_5g"), snap("honor_x6c"), snap("xiaomi_redmi_15c")],
      }],
    },
    installments: { "3m": 1143.92, "6m": 603.84, "9m": 424.24, "12m": 334.76, "18m": 245.90 },
  },
  {
    image_id: "ed3837d5ca554799",
    name: "Lavadora LG 16kg + Cocineta 2Q",
    price: 2699,
    primary_category: "lavadoras",
    categories: ["lavadoras", "cocinas"],
    composition: {
      fixed: [snap("lg_lavadora_16kg"), snap("cocineta_2q_gas")],
      choices: [],
    },
    installments: { "3m": 965.13, "6m": 509.14, "9m": 357.93, "12m": 282.44, "18m": 207.47 },
  },
  {
    image_id: "d0dc2578457a4e44",
    name: "Lavadora Mabe 16kg + Terma Holi 5.5L + Exprimidor",
    price: 2799,
    primary_category: "lavadoras",
    categories: ["lavadoras", "termas"],
    composition: {
      fixed: [snap("mabe_lavadora_16kg"), snap("terma_holi_5_5l"), snap("exprimidor")],
      choices: [],
    },
    installments: { "3m": 1000.88, "6m": 528.34, "9m": 371.20, "12m": 292.90, "18m": 215.16 },
  },
  {
    image_id: "24814848bf2c4ee0",
    name: "Refrigerador Mabe 239L + Cocina 6Q a elección",
    price: 3999,
    primary_category: "refrigeradoras",
    categories: ["refrigeradoras", "cocinas"],
    composition: {
      fixed: [snap("mabe_refri_239l")],
      choices: [{
        label: "01 cocina 6Q a elección",
        pick: 1,
        options: [snap("mabe_cocina_6q"), snap("indurama_cocina_6q")],
      }],
    },
    installments: { "3m": 1429.99, "6m": 754.85, "9m": 530.34, "12m": 418.48, "18m": 307.40 },
  },
  {
    image_id: "222a3c90f0f345c1",
    name: "Encimera Mabe 5Q + Licuadora",
    price: 1999,
    primary_category: "cocinas",
    categories: ["cocinas"],
    composition: {
      fixed: [snap("encimera_mabe_5q"), snap("licuadora")],
      choices: [],
    },
    installments: { "3m": 714.82, "6m": 377.33, "9m": 265.10, "12m": 209.19, "18m": 153.66 },
  },
  {
    image_id: "05b04eb8ce3e4e4b",
    name: "Smart TV 55\" + Cocina Mabe 4Q + Lavadora + Refrigerador",
    price: 4999,
    primary_category: "fusion",
    categories: ["tv", "cocinas", "lavadoras", "refrigeradoras"],
    composition: {
      fixed: [snap("hisense_tv_55"), snap("mabe_cocina_4q"), snap("mabe_lavadora_10kg"), snap("mabe_refri_187l")],
      choices: [],
    },
    installments: { "3m": 1787.57, "6m": 943.61, "9m": 662.95, "12m": 523.12, "18m": 384.27 },
  },
  {
    image_id: "e1249ad5545a4bc2",
    name: "Smart TV JVC 43\" + Cocineta 2Q",
    price: 1799,
    primary_category: "tv",
    categories: ["tv", "cocinas"],
    composition: {
      fixed: [snap("jvc_tv_43"), snap("cocineta_2q_gas")],
      choices: [],
    },
    installments: { "3m": 643.30, "6m": 339.58, "9m": 238.58, "12m": 188.26, "18m": 138.29 },
  },
  {
    image_id: "1cc43a6627cb4389",
    name: "Smart TV JVC 86\" + Cocineta 2Q",
    price: 4999,
    primary_category: "tv",
    categories: ["tv", "cocinas"],
    composition: {
      fixed: [snap("jvc_tv_86"), snap("cocineta_2q_gas")],
      choices: [],
    },
    installments: { "3m": 1787.57, "6m": 943.61, "9m": 662.95, "12m": 523.12, "18m": 384.27 },
  },
  {
    image_id: "5abbad939a8d4fd3",
    name: "Televisor a elección + Cocina a elección",
    price: 4999,
    primary_category: "fusion",
    categories: ["tv", "cocinas"],
    composition: {
      fixed: [],
      choices: [
        { label: "01 televisor a elección", pick: 1, options: [snap("samsung_tv_65"), snap("lg_tv_65")] },
        { label: "01 cocina a elección", pick: 1, options: [snap("mabe_cocina_6q"), snap("indurama_cocina_6q")] },
      ],
    },
    installments: { "3m": 1787.57, "6m": 943.61, "9m": 662.95, "12m": 523.12, "18m": 384.27 },
  },
];
