import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolitenessGate } from "./politeness";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("PolitenessGate", () => {
  it("spaces same-host requests by the min interval", async () => {
    const gate = new PolitenessGate(5000, [30000]);
    await gate.acquire("https://supplier.eg/p/1");
    let done = false;
    void gate.acquire("https://supplier.eg/p/2").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(4999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(done).toBe(true);
  });

  it("does not delay different hosts", async () => {
    const gate = new PolitenessGate(5000, [30000]);
    await gate.acquire("https://a.eg/x");
    let done = false;
    void gate.acquire("https://b.eg/x").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("escalates backoff on repeated blocks", async () => {
    const gate = new PolitenessGate(5000, [30_000, 240_000]);
    await gate.acquire("https://a.eg/x");
    gate.reportBlocked("https://a.eg/x");

    let first = false;
    void gate.acquire("https://a.eg/x").then(() => (first = true));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(first).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(first).toBe(true);

    gate.reportBlocked("https://a.eg/x"); // second consecutive block -> level 2
    let second = false;
    void gate.acquire("https://a.eg/x").then(() => (second = true));
    await vi.advanceTimersByTimeAsync(239_999);
    expect(second).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    expect(second).toBe(true);
  });

  it("reportOk clears the penalty", async () => {
    const gate = new PolitenessGate(1000, [30_000]);
    await gate.acquire("https://a.eg/x");
    gate.reportBlocked("https://a.eg/x");
    gate.reportOk("https://a.eg/x");
    let done = false;
    void gate.acquire("https://a.eg/x").then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1001);
    expect(done).toBe(true);
  });
});
