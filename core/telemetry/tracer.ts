import { v4 as uuidv4 } from "uuid";

export interface Span {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  attributes: Record<string, unknown>;
  status: "ok" | "error";
}

export class Tracer {
  private spans: Map<string, Span> = new Map();
  private activeSpanId?: string;
  private traceId: string;

  constructor(traceId?: string) {
    this.traceId = traceId || uuidv4();
  }

  getTraceId(): string {
    return this.traceId;
  }

  getActiveSpanId(): string | undefined {
    return this.activeSpanId;
  }

  startSpan(name: string, attributes: Record<string, unknown> = {}): Span {
    const spanId = uuidv4();
    const span: Span = {
      spanId,
      traceId: this.traceId,
      parentSpanId: this.activeSpanId,
      name,
      startTime: performance.now(),
      attributes,
      status: "ok",
    };
    this.spans.set(spanId, span);
    this.activeSpanId = spanId;
    return span;
  }

  endSpan(spanId?: string, status: "ok" | "error" = "ok", extraAttributes?: Record<string, unknown>): Span | undefined {
    const id = spanId || this.activeSpanId;
    if (!id) return undefined;
    const span = this.spans.get(id);
    if (!span) return undefined;
    span.endTime = performance.now();
    span.status = status;
    if (extraAttributes) Object.assign(span.attributes, extraAttributes);
    this.activeSpanId = span.parentSpanId;
    return span;
  }

  getSpan(spanId: string): Span | undefined {
    return this.spans.get(spanId);
  }

  duration(spanId: string): number | undefined {
    const span = this.spans.get(spanId);
    if (!span || !span.endTime) return undefined;
    return Math.round((span.endTime - span.startTime) * 100) / 100;
  }

  getTrace(): Span[] {
    return [...this.spans.values()];
  }

  async withSpan<T>(name: string, attributes: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
    const span = this.startSpan(name, attributes);
    try {
      const result = await fn();
      this.endSpan(span.spanId, "ok");
      return result;
    } catch (error: any) {
      this.endSpan(span.spanId, "error", { error: error.message });
      throw error;
    }
  }
}

const tracers = new Map<string, Tracer>();

export function getTracer(traceId?: string): Tracer {
  const id = traceId || "default";
  if (!tracers.has(id)) {
    tracers.set(id, new Tracer(traceId));
  }
  return tracers.get(id)!;
}
