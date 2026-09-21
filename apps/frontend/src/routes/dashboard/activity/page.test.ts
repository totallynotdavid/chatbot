/// <reference types="bun" />

import { describe, it, expect } from "bun:test";
import "../../../lib/testing/svelte-ssr.ts";
import { render } from "svelte/server";

describe("the activity page", () => {
  /**
   * Every other page prints es-PE dates in America/Lima. This instant is
   * 03:13 UTC on the 15th, still the evening of the 14th in Lima, so a page
   * that formats in en-US or in the machine's zone shows something else.
   */
  it("shows a log's time in es-PE and America/Lima", async () => {
    const { default: Page } = await import("./+page.svelte");
    const props = {
      data: {
        logs: [
          {
            id: "1",
            timestamp: 1_700_018_000_000,
            status: "success",
            source: "system",
            event: "test_event",
            summary: "resumen",
            actor: "system",
            metadata: {},
            original_data: {},
          },
        ],
      },
    };

    const { body } = render(Page, { props: props as never });

    expect(body).toContain("14/11/2023");
    expect(body).toContain("10:13:20");
    expect(body).not.toContain("Nov");
  });
});
