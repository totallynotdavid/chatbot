import { db } from "../db/index.ts";
import type { ProviderCheckResult } from "@totem/types";

type TestPersona = {
  id: string;
  name: string;
  description: string;
  segment: "fnb" | "gaso" | "not_eligible";
  clientName: string;
  dni: string;
  creditLine: number;
  nse?: number;
  isActive: boolean;
};

const INITIAL_PERSONAS: TestPersona[] = [
  {
    id: "fnb_high_credit",
    name: "FNB - Crédito Alto (S/ 8000)",
    description: "Cliente FNB aprobado con línea de crédito de S/ 8000",
    segment: "fnb",
    clientName: "MARIA ELENA TORRES GARCIA",
    dni: "12345678",
    creditLine: 8000,
    isActive: true,
  },
  {
    id: "fnb_medium_credit",
    name: "FNB - Crédito Medio (S/ 3000)",
    description: "Cliente FNB aprobado con línea de crédito de S/ 3000",
    segment: "fnb",
    clientName: "CARLOS ALBERTO RODRIGUEZ PEREZ",
    dni: "23456789",
    creditLine: 3000,
    isActive: true,
  },
  {
    id: "fnb_low_credit",
    name: "FNB / Crédito bajo (S/ 1200)",
    description: "Cliente FNB aprobado con línea de crédito de S/ 1200",
    segment: "fnb",
    clientName: "ROSA MARIA SILVA CHAVEZ",
    dni: "34567890",
    creditLine: 1200,
    isActive: true,
  },
  {
    id: "gaso_nse_a",
    name: "GASO - NSE A (S/ 5000)",
    description: "Cliente GASO elegible, NSE A, crédito de S/ 5000",
    segment: "gaso",
    clientName: "JUAN PABLO MENDOZA FLORES",
    dni: "45678901",
    creditLine: 5000,
    nse: 1,
    isActive: true,
  },
  {
    id: "gaso_nse_b",
    name: "GASO - NSE B (S/ 2500)",
    description: "Cliente GASO elegible, NSE B, crédito de S/ 2500",
    segment: "gaso",
    clientName: "PATRICIA LEONOR GUTIERREZ RAMOS",
    dni: "56789012",
    creditLine: 2500,
    nse: 2,
    isActive: true,
  },
  {
    id: "gaso_nse_c",
    name: "GASO - NSE C (S/ 1500)",
    description: "Cliente GASO elegible, NSE C, crédito de S/ 1500",
    segment: "gaso",
    clientName: "LUIS FERNANDO CASTRO DIAZ",
    dni: "67890123",
    creditLine: 1500,
    nse: 3,
    isActive: true,
  },
  {
    id: "not_eligible_no_credit",
    name: "No Elegible - Sin Crédito",
    description: "Cliente encontrado pero no elegible (sin línea de crédito)",
    segment: "not_eligible",
    clientName: "SOFIA Isabel VARGAS LOPEZ",
    dni: "78901234",
    creditLine: 0,
    isActive: true,
  },
  {
    id: "not_found",
    name: "No Encontrado",
    description: "DNI no encontrado en ningún sistema",
    segment: "not_eligible",
    clientName: "NOT FOUND",
    dni: "89012345",
    creditLine: 0,
    isActive: true,
  },
];

export const PersonasService = {
  getAll(): TestPersona[] {
    // Get from database
    const dbPersonas = db
      .prepare(
        `SELECT id, name, description, segment, client_name as clientName, 
                dni, credit_line as creditLine, nse, is_active as isActive
         FROM test_personas 
         WHERE is_active = 1
         ORDER BY segment, credit_line DESC`,
      )
      .all() as TestPersona[];

    // Merge with hardcoded personas (db takes precedence)
    const dbIds = new Set(dbPersonas.map((p) => p.id));
    const hardcodedFiltered = INITIAL_PERSONAS.filter((p) => !dbIds.has(p.id));

    return [...dbPersonas, ...hardcodedFiltered];
  },

  getById(id: string): TestPersona | undefined {
    // Check database first
    const dbPersona = db
      .prepare(
        `SELECT id, name, description, segment, client_name as clientName, 
                dni, credit_line as creditLine, nse, is_active as isActive
         FROM test_personas 
         WHERE id = ? AND is_active = 1`,
      )
      .get(id) as
      | {
          id: string;
          name: string;
          description: string | null;
          segment: "fnb" | "gaso" | "not_eligible";
          clientName: string;
          dni: string;
          creditLine: number;
          nse: number | null;
          isActive: number;
        }
      | undefined;

    if (dbPersona) {
      return {
        ...dbPersona,
        description: dbPersona.description || "",
        nse: dbPersona.nse ?? undefined,
        isActive: dbPersona.isActive === 1,
      };
    }

    // Fallback to hardcoded
    return INITIAL_PERSONAS.find((p) => p.id === id);
  },

  toProviderResult(persona: TestPersona): ProviderCheckResult {
    if (persona.segment === "not_eligible") {
      if (persona.id === "not_found") {
        return {
          eligible: false,
          credit: 0,
          name: undefined,
        };
      }
      return {
        eligible: false,
        credit: persona.creditLine,
        name: persona.clientName,
        reason: "not_eligible_per_calidda",
      };
    }

    return {
      eligible: true,
      credit: persona.creditLine,
      name: persona.clientName,
      nse: persona.nse,
    };
  },

  create(
    persona: Omit<TestPersona, "isActive">,
    createdBy: string,
  ): TestPersona {
    db.prepare(
      `INSERT INTO test_personas (id, name, description, segment, client_name, dni, credit_line, nse, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      persona.id,
      persona.name,
      persona.description,
      persona.segment,
      persona.clientName,
      persona.dni,
      persona.creditLine,
      persona.nse || null,
      createdBy,
    );

    return { ...persona, isActive: true };
  },

  update(id: string, updates: Partial<Omit<TestPersona, "id" | "isActive">>) {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];

    if (updates.name !== undefined) {
      sets.push("name = ?");
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      sets.push("description = ?");
      values.push(updates.description);
    }
    if (updates.segment !== undefined) {
      sets.push("segment = ?");
      values.push(updates.segment);
    }
    if (updates.clientName !== undefined) {
      sets.push("client_name = ?");
      values.push(updates.clientName);
    }
    if (updates.dni !== undefined) {
      sets.push("dni = ?");
      values.push(updates.dni);
    }
    if (updates.creditLine !== undefined) {
      sets.push("credit_line = ?");
      values.push(updates.creditLine);
    }
    if (updates.nse !== undefined) {
      sets.push("nse = ?");
      values.push(updates.nse);
    }

    if (sets.length === 0) return;

    values.push(id);
    db.prepare(`UPDATE test_personas SET ${sets.join(", ")} WHERE id = ?`).run(
      ...values,
    );
  },

  delete(id: string) {
    db.prepare("UPDATE test_personas SET is_active = 0 WHERE id = ?").run(id);
  },
};
