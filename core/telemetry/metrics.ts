interface MetricLabels { [key: string]: string }

class Counter {
  private values = new Map<string, number>();
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
  }

  inc(labels: MetricLabels = {}, value = 1): void {
    const key = this.labelKey(labels);
    this.values.set(key, (this.values.get(key) || 0) + value);
  }

  private labelKey(labels: MetricLabels): string {
    return this.labelNames.map((n) => `${n}=${labels[n] || ""}`).join(",");
  }

  collect(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [key, val] of this.values) {
      const labels = key ? `{${key}}` : "";
      lines.push(`${this.name}${labels} ${val}`);
    }
    return lines.join("\n") + "\n";
  }
}

class Histogram {
  private buckets = new Map<string, number[]>();
  private sums = new Map<string, number>();
  private counts = new Map<string, number>();
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  readonly bucketBounds: number[];

  constructor(name: string, help: string, bucketBounds: number[], labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.bucketBounds = bucketBounds;
  }

  observe(value: number, labels: MetricLabels = {}): void {
    const key = this.labelKey(labels);
    const current = this.buckets.get(key) || new Array(this.bucketBounds.length).fill(0);
    for (let i = 0; i < this.bucketBounds.length; i++) {
      if (value <= this.bucketBounds[i]!) current[i]++;
    }
    this.buckets.set(key, current);
    this.sums.set(key, (this.sums.get(key) || 0) + value);
    this.counts.set(key, (this.counts.get(key) || 0) + 1);
  }

  private labelKey(labels: MetricLabels): string {
    return this.labelNames.map((n) => `${n}=${labels[n] || ""}`).join(",");
  }

  collect(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [key, bucketVals] of this.buckets) {
      const labels = key ? `{${key}}` : "";
      let cumulative = 0;
      for (let i = 0; i < this.bucketBounds.length; i++) {
        cumulative += bucketVals[i]!;
        lines.push(`${this.name}_bucket${labels},le="${this.bucketBounds[i]}" ${cumulative}`);
      }
      lines.push(`${this.name}_bucket${labels},le="+Inf" ${cumulative}`);
      lines.push(`${this.name}_sum${labels} ${this.sums.get(key) || 0}`);
      lines.push(`${this.name}_count${labels} ${this.counts.get(key) || 0}`);
    }
    return lines.join("\n") + "\n";
  }
}

class Gauge {
  private values = new Map<string, number>();
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];

  constructor(name: string, help: string, labelNames: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
  }

  set(value: number, labels: MetricLabels = {}): void {
    this.values.set(this.labelKey(labels), value);
  }

  private labelKey(labels: MetricLabels): string {
    return this.labelNames.map((n) => `${n}=${labels[n] || ""}`).join(",");
  }

  collect(): string {
    const lines: string[] = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} gauge`];
    for (const [key, val] of this.values) {
      const labels = key ? `{${key}}` : "";
      lines.push(`${this.name}${labels} ${val}`);
    }
    return lines.join("\n") + "\n";
  }
}

// Pre-registered metrics
export const metrics = {
  httpRequests: new Counter(
    "http_requests_total",
    "Total HTTP requests",
    ["method", "path", "status"]
  ),
  httpRequestDuration: new Histogram(
    "http_request_duration_ms",
    "HTTP request duration in ms",
    [10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
    ["path"]
  ),
  eventsPublished: new Counter(
    "events_published_total",
    "Total events published to event bus",
    ["event_type"]
  ),
  eventsSubscribed: new Counter(
    "events_subscribed_total",
    "Total events received by subscribers",
    ["event_type", "worker"]
  ),
  workerProcessingDuration: new Histogram(
    "worker_processing_duration_ms",
    "Worker processing duration in ms",
    [10, 50, 100, 250, 500, 1000, 5000],
    ["worker"]
  ),
  workerErrors: new Counter(
    "worker_errors_total",
    "Total worker errors",
    ["worker", "error_type"]
  ),
  activeQuotes: new Gauge(
    "active_quotes",
    "Currently active quotes in process"
  ),
  circuitBreakerState: new Gauge(
    "circuit_breaker_state",
    "Circuit breaker state: 0=CLOSED, 1=OPEN, 2=HALF_OPEN",
    ["name"]
  ),
};

export function metricsText(): string {
  return Object.values(metrics).map((m) => m.collect()).join("");
}
