/** The dashboard and the server name the same Lima calendar day for every instant, at and around its midnight. */

import { describe, it, expect } from "bun:test";

import { limaDateString as serverDate } from "../src/db/query.ts";

// Loaded by a computed path: the SvelteKit file is outside this project's tsc rootDir.
const FORMATTERS_PATH = "../../frontend/src/lib/utils/formatters.ts";
const { limaDateString: dashboardDate } = (await import(FORMATTERS_PATH)) as {
  limaDateString: (timestamp?: number) => string;
};

const HOUR = 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** The `YYYY-MM-DD` of the UTC calendar day `offset` days from `date`. */
function shiftDay(date: string, offset: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + offset));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

// The 1st, 15th and last day of every month of 2026, plus a leap day and two year turns.
const DAYS = [
  ...Array.from({ length: 12 }, (_, month) => {
    const last = new Date(Date.UTC(2026, month + 1, 0)).getUTCDate();
    return [1, 15, last].map((d) => `2026-${pad(month + 1)}-${pad(d)}`);
  }).flat(),
  "2028-02-29",
  "2026-12-31",
  "2027-01-01",
];

describe("the Lima date the dashboard and the server agree on", () => {
  describe.each(DAYS)("%s", (day) => {
    // Lima midnight that opens `day`, in UTC ms.
    const midnight = Date.parse(`${day}T05:00:00.000Z`);
    const before = shiftDay(day, -1);

    it.each([
      ["2 ms before Lima midnight", midnight - 2, before],
      ["1 ms before Lima midnight (04:59:59.999Z)", midnight - 1, before],
      ["Lima midnight (05:00:00.000Z)", midnight, day],
      ["1 ms after Lima midnight", midnight + 1, day],
      ["Lima noon", midnight + 12 * HOUR, day],
      ["the last millisecond of the day", midnight + 24 * HOUR - 1, day],
    ])("%s", (_label, instant, expected) => {
      expect(dashboardDate(instant)).toBe(expected);
      expect(serverDate(instant)).toBe(expected);
    });
  });

  it("names today by default", () => {
    expect(dashboardDate()).toBe(serverDate(Date.now()));
  });
});
