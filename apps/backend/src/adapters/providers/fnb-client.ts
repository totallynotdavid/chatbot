import jwt from "jsonwebtoken";
import { config } from "../../config.ts";

type FNBSession = {
  token: string;
  allyId: string;
  expiresAt: Date;
};

type FNBAuthResponse = {
  valid: boolean;
  message?: string;
  data?: {
    authToken: string;
  };
};

type FNBCreditResponse = {
  valid: boolean;
  data?: {
    lineaCredito?: string;
    nombre?: string;
  };
};

type JwtPayload = {
  commercialAllyId: string;
};

let sessionCache: FNBSession | null = null;

async function authenticate(): Promise<FNBSession> {
  if (sessionCache && sessionCache.expiresAt > new Date()) {
    return sessionCache;
  }

  const authUrl = `${config.calidda.baseUrl}/FNB_Services/api/Seguridad/autenticar`;

  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://appweb.calidda.com.pe",
      referer: "https://appweb.calidda.com.pe/WebFNB/login",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    body: JSON.stringify({
      usuario: config.calidda.credentials.username,
      password: config.calidda.credentials.password,
      captcha: "exitoso",
      Latitud: "",
      Longitud: "",
    }),
  });

  if (!response.ok) {
    throw new Error(`FNB Auth HTTP ${response.status}`);
  }

  const data = (await response.json()) as FNBAuthResponse;

  if (!(data.valid && data.data?.authToken)) {
    throw new Error(`FNB Auth Invalid: ${data.message || "No token"}`);
  }

  const decoded = jwt.decode(data.data.authToken) as JwtPayload | null;
  if (!decoded) {
    throw new Error("Failed to decode JWT token");
  }

  sessionCache = {
    token: data.data.authToken,
    allyId: decoded.commercialAllyId,
    expiresAt: new Date(Date.now() + 3500 * 1000),
  };

  return sessionCache;
}

async function queryCreditLine(dni: string): Promise<FNBCreditResponse> {
  const session = await authenticate();

  const params = new URLSearchParams({
    numeroDocumento: dni,
    tipoDocumento: "PE2",
    idAliado: session.allyId,
    canal: "FNB",
  });

  const url = `${config.calidda.baseUrl}/FNB_Services/api/financiamiento/lineaCredito?${params}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${session.token}`,
      "Content-Type": "application/json",
      referer: "https://appweb.calidda.com.pe/WebFNB/consulta-credito",
    },
  });

  if (!res.ok) {
    throw new Error(`FNB Query Failed: ${res.status}`);
  }

  return (await res.json()) as FNBCreditResponse;
}

export const FNBClient = {
  authenticate,
  queryCreditLine,
};
