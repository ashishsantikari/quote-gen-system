import type { IEventBus } from "../../core/ports/IEventBus";
import type { QuoteEvent, EventType } from "../../core/events/types";
import { Logger } from "../../core/telemetry/logger";
import { metrics } from "../../core/telemetry/metrics";

const log = new Logger({ component: "InMemoryEventBus" });

export class InMemoryEventBus implements IEventBus {
  private subscribers: Map<
    EventType,
    Set<(event: QuoteEvent) => Promise<void>>
  > = new Map();

  async publish(event: QuoteEvent): Promise<void> {
    const handlers = this.subscribers.get(event.type);
    metrics.eventsPublished.inc({ event_type: event.type });
    if (!handlers) {
      log.debug("publish: no subscribers", {
        eventType: event.type,
        traceId: event.traceId,
      });
      return;
    }

    log.debug("publish", {
      eventType: event.type,
      traceId: event.traceId,
      spanId: event.spanId,
      handlerCount: handlers.size,
    });

    const results = await Promise.allSettled(
      [...handlers].map((handler) => handler(event)),
    );

    for (const result of results) {
      if (result.status === "rejected") {
        log.error("handler error", {
          eventType: event.type,
          traceId: event.traceId,
          error: String(result.reason),
        });
      }
    }
  }

  subscribe(
    eventType: EventType,
    handler: (event: QuoteEvent) => Promise<void>,
  ): void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);
    log.debug("subscribe", {
      eventType,
      subscriberCount: this.subscribers.get(eventType)!.size,
    });
  }
}

export default InMemoryEventBus;
