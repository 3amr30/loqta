/**
 * Per-domain politeness for the scraper (spec §8 hard rule):
 *  - at most one in-flight request per host, serialized
 *  - min interval between requests to the same host
 *  - exponential backoff after 403/429 (30s -> 4min -> 20min)
 * In-memory: resets on worker restart, which is acceptable - the sweep
 * and sync cadences keep per-host volume low anyway.
 */

interface HostState {
  last: number;
  penaltyUntil: number;
  level: number; // -1 = no penalty
  chain: Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class PolitenessGate {
  private hosts = new Map<string, HostState>();

  constructor(
    private minIntervalMs = 5_000,
    private backoffMs: number[] = [30_000, 240_000, 1_200_000],
  ) {}

  private state(host: string): HostState {
    let h = this.hosts.get(host);
    if (!h) {
      h = { last: 0, penaltyUntil: 0, level: -1, chain: Promise.resolve() };
      this.hosts.set(host, h);
    }
    return h;
  }

  /** Resolves when it is polite to hit the URL's host. Serializes per host. */
  acquire(url: string): Promise<void> {
    const h = this.state(new URL(url).hostname);
    const turn = h.chain.then(async () => {
      const waitUntil = Math.max(h.last + this.minIntervalMs, h.penaltyUntil);
      const delay = waitUntil - Date.now();
      if (delay > 0) await sleep(delay);
      h.last = Date.now();
    });
    h.chain = turn.catch(() => {});
    return turn;
  }

  /** Call after a 403/429: escalates the host's backoff penalty. */
  reportBlocked(url: string): void {
    const h = this.state(new URL(url).hostname);
    h.level = Math.min(h.level + 1, this.backoffMs.length - 1);
    h.penaltyUntil = Date.now() + this.backoffMs[h.level]!;
  }

  /** Call after a successful fetch: clears any penalty. */
  reportOk(url: string): void {
    const h = this.hosts.get(new URL(url).hostname);
    if (h) {
      h.level = -1;
      h.penaltyUntil = 0;
    }
  }
}

export const politeness = new PolitenessGate();
