import { describe, expect, it } from "vitest";
import { getFxRate, isFxStale } from "./fx";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-07-11T00:00:00Z").getTime();

describe("isFxStale (7-day guard)", () => {
  it("flags rates older than 7 days", () => {
    expect(isFxStale(new Date(NOW - 8 * DAY), NOW)).toBe(true);
  });

  it("accepts rates fresher than 7 days", () => {
    expect(isFxStale(new Date(NOW - 6 * DAY), NOW)).toBe(false);
  });

  it("boundary: exactly 7 days is still fresh", () => {
    expect(isFxStale(new Date(NOW - 7 * DAY), NOW)).toBe(false);
    expect(isFxStale(new Date(NOW - 7 * DAY - 1), NOW)).toBe(true);
  });
});

describe("getFxRate same-currency fast path", () => {
  it("returns rate 1 without touching the DB", async () => {
    // No DATABASE_URL in the test env - this would throw if it queried.
    const fx = await getFxRate("EGP", "egp");
    expect(fx).toEqual({ rate: 1, stale: false, fetchedAt: null });
  });
});
