import { Hono } from "hono";
import { pathParam } from "../lib/http.ts";
import { requirePlatformOperator } from "../middleware/auth.ts";
import { getAllStatus } from "../adapters/providers/health.ts";
import { eligibilityHandler } from "../bootstrap/index.ts";
import { isOk } from "../shared/result/index.ts";

const app = new Hono();

// The lookup belongs to no tenant and returns one person's credit standing,
// so only VendeYa's own staff may run it.
app.get("/:dni", requirePlatformOperator, async (c) => {
  const dni = pathParam(c, "dni");

  if (!/^\d{8}$/.test(dni)) {
    return c.json({ error: "DNI debe tener 8 dígitos" }, 400);
  }

  try {
    const result = await eligibilityHandler.execute(dni);
    const healthStatus = getAllStatus();

    let displayResult: any = result;
    if (isOk(result)) {
      displayResult = result.value;
    } else {
      displayResult = {
        error: result.error.message,
        details: result.error,
      };
    }

    return c.json({
      dni,
      result: displayResult,
      providersChecked: [
        ...(healthStatus.fnb.available ? ["fnb"] : []),
        ...(healthStatus.gaso.available ? ["gaso"] : []),
      ],
    });
  } catch (error) {
    return c.json({ error: "Error al consultar proveedor" }, 500);
  }
});

export default app;
