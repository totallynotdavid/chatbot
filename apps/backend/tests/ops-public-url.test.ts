/**
 * Alert links and the CORS origin name the deployment's public address. They
 * read `PUBLIC_URL`.
 */

import { afterEach, describe, expect, it } from "bun:test";
import process from "node:process";
import * as utils from "@vendeya/utils";
import { templates } from "../src/domains/notifications/templates.ts";

const PRODUCTION_URL = "https://ventas.example.com";

const saved = { PUBLIC_URL: process.env.PUBLIC_URL };

function setPublicUrl(publicUrl: string | undefined) {
  if (publicUrl === undefined) delete process.env.PUBLIC_URL;
  else process.env.PUBLIC_URL = publicUrl;
}

afterEach(() => {
  setPublicUrl(saved.PUBLIC_URL);
});

describe("the public origin", () => {
  it("is PUBLIC_URL", () => {
    setPublicUrl("http://192.168.1.20:5173");

    expect(utils.publicOrigin()).toBe("http://192.168.1.20:5173");
  });

  it("falls back to localhost when PUBLIC_URL is unset or empty", () => {
    setPublicUrl(undefined);
    expect(utils.publicOrigin()).toBe("http://localhost:5173");

    setPublicUrl("  ");
    expect(utils.publicOrigin()).toBe("http://localhost:5173");
  });

  it("drops trailing slashes, which CORS never matches and links double", () => {
    setPublicUrl(`${PRODUCTION_URL}//`);

    expect(utils.publicOrigin()).toBe(PRODUCTION_URL);
  });
});

describe("the backend URL", () => {
  const saved = process.env.BACKEND_URL;

  afterEach(() => {
    if (saved === undefined) delete process.env.BACKEND_URL;
    else process.env.BACKEND_URL = saved;
  });

  it("is the local backend when BACKEND_URL is unset or empty", () => {
    delete process.env.BACKEND_URL;
    expect(utils.getBackendUrl()).toBe("http://localhost:3000");

    process.env.BACKEND_URL = " ";
    expect(utils.getBackendUrl()).toBe("http://localhost:3000");
  });

  it("is BACKEND_URL, with the trailing slash dropped", () => {
    process.env.BACKEND_URL = "http://backend:3000/";

    expect(utils.getBackendUrl()).toBe("http://backend:3000");
  });
});

describe("in production", () => {
  it("names PUBLIC_URL in the frontend and media URLs", () => {
    setPublicUrl(PRODUCTION_URL);

    expect(utils.getFrontendUrl()).toBe(PRODUCTION_URL);
    expect(utils.getPublicUrl()).toBe(PRODUCTION_URL);
  });

  it("links alerts to PUBLIC_URL, not localhost", () => {
    setPublicUrl(PRODUCTION_URL);

    const message = templates.escalation(
      { phoneNumber: "51999999999", channelAccountId: "ch-1" },
      "el cliente pidió un asesor",
    );

    expect(message).toContain(
      `${PRODUCTION_URL}/dashboard/conversations/51999999999?channel=ch-1`,
    );
    expect(message).not.toContain("localhost");
  });

  it("links system notices to the activity page", () => {
    setPublicUrl(PRODUCTION_URL);

    const message = templates.systemError(
      { phoneNumber: "51999999999" },
      "provider unavailable",
    );

    expect(message).toContain(`${PRODUCTION_URL}/dashboard/activity`);
    expect(message).not.toContain("/dashboard/logs");
  });
});
