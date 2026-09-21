/// <reference types="bun" />

import { describe, it, expect } from "bun:test";
import "../../testing/svelte-ssr.ts";
import { render } from "svelte/server";

const payload = "<img src=x onerror=alert(1)>";
const attributePayload = `x" onmouseover="alert(1)`;

describe("a dashboard table", () => {
  /**
   * The activity page shows a `summary` the catalog editor controls (a bundle
   * name ends up in it). It reaches the page through a column snippet, so
   * Svelte escapes it. The old string renderer put it in as HTML, and every
   * admin who opened the page ran the script.
   */
  it("shows a stored value as text, in a cell and in an attribute", async () => {
    const { default: Page } = await import(
      "../../../routes/dashboard/activity/+page.svelte"
    );
    // The page's load data also carries the user; the table reads `logs` only.
    const props = {
      data: {
        logs: [
          {
            id: "1",
            timestamp: 1_700_000_000_000,
            status: payload,
            source: "system",
            event: payload,
            summary: attributePayload,
            actor: payload,
            metadata: {},
            original_data: {},
          },
        ],
      },
    };
    const { body } = render(Page, { props: props as never });

    expect(body).toContain("&lt;img");
    expect(body).not.toContain("<img");
    // The `title` attribute holds the summary, so a quote must not end it.
    expect(body).toContain("&quot;");
    expect(body).not.toContain(` onmouseover="alert(1)"`);
  });
});
