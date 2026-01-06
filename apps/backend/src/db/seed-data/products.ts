import type { BundleComposition, InstallmentSchedule } from "@totem/types";

/** Base product templates extracted from GASO catalog */
export const BASE_PRODUCTS = [
  // Cocinas
  { id: "cocineta_2q_gas", name: "Cocineta 2Q A gas", category: "cocinas", brand: null, model: null, specs: { peso: "3kg", material: "esmaltado" } },
  { id: "mabe_cocina_4q", name: "Cocina Mabe 4Q", category: "cocinas", brand: "Mabe", model: "TX511OP2", specs: { encendido: "manual", horno: "gas natural", capacidad_horno: "63L", peso: "23kg" } },
  { id: "mabe_cocina_6q", name: "Cocina Mabe 6Q", category: "cocinas", brand: "Mabe", model: "CMP7625FX0", specs: { quemadores: 6 } },
  { id: "indurama_cocina_6q", name: "Cocina Indurama 6Q", category: "cocinas", brand: "Indurama", model: "PARMA", specs: { quemadores: 6 } },
  { id: "miray_cocina_4q", name: "Cocina Miray 4Q", category: "cocinas", brand: "Miray", model: "IRIS PLUS", specs: { quemadores: 4 } },
  { id: "encimera_mabe_5q", name: "Encimera Mabe 5Q", category: "cocinas", brand: "Mabe", model: "PM8655GV0", specs: { quemadores: 5, encendido: "eléctrico", material: "vidrio templado negro" } },

  // Termas
  { id: "terma_holi_5_5l", name: "Terma Holi 5.5L A gas", category: "termas", brand: "Holi", model: "MISTI", specs: { capacidad: "5.5L", color: "blanco", rango: "35ºC-65ºC", gas: "natural" } },

  // Celulares
  { id: "samsung_a56", name: "Samsung Galaxy A56", category: "celulares", brand: "Samsung", model: "A56", specs: { storage: "256GB", ram: "8GB", display: "6.7\" amoled" } },
  { id: "samsung_a35", name: "Samsung Galaxy A35", category: "celulares", brand: "Samsung", model: "A35", specs: { storage: "256GB", ram: "8GB" } },
  { id: "samsung_a26", name: "Samsung Galaxy A26", category: "celulares", brand: "Samsung", model: "A26", specs: { storage: "128GB", ram: "6GB" } },
  { id: "samsung_a17_5g", name: "Samsung Galaxy A17 5G", category: "celulares", brand: "Samsung", model: "A17 5G", specs: {} },
  { id: "xiaomi_redmi_15c", name: "Xiaomi Redmi 15C", category: "celulares", brand: "Xiaomi", model: "Redmi 15C", specs: {} },
  { id: "honor_x6c", name: "Honor X6C", category: "celulares", brand: "Honor", model: "X6C", specs: {} },

  // TVs
  { id: "jvc_tv_43", name: "Smart TV JVC 43\"", category: "tv", brand: "JVC", model: "LT-43KM348", specs: { resolution: "FHD", os: "Google TV", connectivity: "WiFi/Bluetooth" } },
  { id: "jvc_tv_86", name: "Smart TV JVC 86\"", category: "tv", brand: "JVC", model: "LT-86KB738", specs: { size: "86\"" } },
  { id: "hisense_tv_50", name: "Smart TV Hisense 50\"", category: "tv", brand: "Hisense", model: null, specs: { size: "50\"" } },
  { id: "hisense_tv_55", name: "Smart TV Hisense 55\"", category: "tv", brand: "Hisense", model: null, specs: { size: "55\"", control: "remoto" } },
  { id: "samsung_tv_65", name: "Smart TV Samsung 65\"", category: "tv", brand: "Samsung", model: "UN65DU8000GXPE", specs: { size: "65\"" } },
  { id: "lg_tv_65", name: "Smart TV LG 65\"", category: "tv", brand: "LG", model: "65UA7300PSB", specs: { size: "65\"" } },

  // Refrigeradoras
  { id: "mabe_refri_187l", name: "Refrigeradora Mabe 187L", category: "refrigeradoras", brand: "Mabe", model: "RMU202PXPRS1", specs: { capacidad: "187L", tipo: "monopuerta", acabado: "inoxidable" } },
  { id: "mabe_refri_230l", name: "Refrigeradora Mabe 230L", category: "refrigeradoras", brand: "Mabe", model: null, specs: { capacidad: "230L", tipo: "congelador superior", dispensador: "agua" } },
  { id: "mabe_refri_239l", name: "Refrigeradora Mabe 239L", category: "refrigeradoras", brand: "Mabe", model: "RMA255FYPG", specs: { capacidad: "239L", tipo: "congelador superior", dispensador: "agua", parillas: 3 } },
  { id: "mabe_refri_511l", name: "Refrigeradora Mabe 511L", category: "refrigeradoras", brand: "Mabe", model: null, specs: { capacidad: "511L" } },
  { id: "lg_refri_509l", name: "Refrigeradora LG 509L", category: "refrigeradoras", brand: "LG", model: null, specs: { capacidad: "509L" } },
  { id: "indurama_refri_508l", name: "Refrigeradora Indurama 508L", category: "refrigeradoras", brand: "Indurama", model: null, specs: { capacidad: "508L" } },

  // Lavadoras
  { id: "mabe_lavadora_9kg", name: "Lavadora Mabe 9kg", category: "lavadoras", brand: "Mabe", model: null, specs: { capacidad: "9kg" } },
  { id: "mabe_lavadora_10kg", name: "Lavadora Mabe 10kg", category: "lavadoras", brand: "Mabe", model: "LMAP1010WBBB0", specs: { capacidad: "10kg" } },
  { id: "mabe_lavadora_16kg", name: "Lavadora Mabe 16kg", category: "lavadoras", brand: "Mabe", model: "LMAP6115WGBB0", specs: { capacidad: "16kg", color: "silver", carga: "superior" } },
  { id: "mabe_lavadora_22kg", name: "Lavadora Mabe 22kg", category: "lavadoras", brand: "Mabe", model: null, specs: { capacidad: "22kg" } },
  { id: "lg_lavadora_16kg", name: "Lavadora LG 16kg", category: "lavadoras", brand: "LG", model: "WT16BVTB", specs: { capacidad: "16kg", color: "negro", panel: "LED" } },
  { id: "samsung_lavadora_13kg", name: "Lavadora Samsung 13kg", category: "lavadoras", brand: "Samsung", model: null, specs: { capacidad: "13kg" } },
  { id: "lavaseca_lg_samsung", name: "Lavaseca LG/Samsung", category: "lavadoras", brand: null, model: null, specs: { lavado: "11kg", secado: "7kg" } },

  // Audio
  { id: "samsung_torre_sonido", name: "Torre de sonido Samsung", category: "audio", brand: "Samsung", model: null, specs: {} },
  { id: "lg_torre_sonido", name: "Torre de sonido LG", category: "audio", brand: "LG", model: null, specs: {} },

  // Pequeños electrodomésticos
  { id: "licuadora", name: "Licuadora", category: "pequeños", brand: null, model: null, specs: {} },
  { id: "exprimidor", name: "Exprimidor", category: "pequeños", brand: null, model: null, specs: {} },
] as const;

export type BaseProductId = (typeof BASE_PRODUCTS)[number]["id"];
