export interface LatencySummary {
  /** Samples recorded since the tab opened. */
  readonly count: number;
  readonly last: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
}

/** Rolling statistics over the most recent latency samples. */
export class LatencyTracker {
  private readonly samples: number[] = [];
  private count = 0;

  constructor(private readonly capacity = 200) {}

  record(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.samples.push(ms);
    if (this.samples.length > this.capacity) this.samples.shift();
    this.count += 1;
  }

  summary(): LatencySummary | null {
    const last = this.samples.at(-1);
    if (last === undefined) return null;
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((total, sample) => total + sample, 0);
    return {
      count: this.count,
      last,
      mean: sum / sorted.length,
      p95: sorted[Math.ceil(0.95 * sorted.length) - 1] ?? last,
      max: sorted.at(-1) ?? last,
    };
  }
}
