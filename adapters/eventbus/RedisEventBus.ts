import Redis from "ioredis";
import type { IEventBus } from "../../core/ports/IEventBus";
import type { QuoteEvent } from "../../core/events/types";
import { EventType } from "../../core/events/types";
import { InMemoryEventBus } from "./InMemoryEventBus";
import { Logger } from "../../core/telemetry/logger";

const log = new Logger({ component: "RedisEventBus" });

export class RedisEventBus implements IEventBus {
  private pub: Redis;
  private sub: Redis;
  private handlers = new Map<
    string,
    Set<(event: QuoteEvent) => Promise<void>>
  >();

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || "redis://localhost:6379";
    log.info("connecting", { url });
    this.pub = new Redis(url, { lazyConnect: false });
    this.sub = new Redis(url, { lazyConnect: false });
    this.pub.on("error", (err) =>
      log.error("pub error", { error: err.message }),
    );
    this.sub.on("error", (err) =>
      log.error("sub error", { error: err.message }),
    );
  }

  async publish(event: QuoteEvent): Promise<void> {
    log.debug("publish", { eventType: event.type, traceId: event.traceId });
    await this.pub.publish(event.type, JSON.stringify(event));
  }

  subscribe(
    eventType: EventType,
    handler: (event: QuoteEvent) => Promise<void>,
  ): void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
      void this.sub.subscribe(eventType);
    }
    this.handlers.get(eventType)!.add(handler);
    log.debug("subscribe", {
      eventType,
      subscriberCount: this.handlers.get(eventType)!.size,
    });

    if (this.sub.listenerCount("message") === 0) {
      this.sub.on("message", (channel: string, message: string) => {
        const subs = this.handlers.get(channel);
        if (!subs) return;
        const event = JSON.parse(message) as QuoteEvent;
        log.debug("received", {
          eventType: event.type,
          traceId: event.traceId,
        });
        for (const h of subs) {
          h(event).catch((err) => {
            log.error("handler error", {
              eventType: event.type,
              traceId: event.traceId,
              error: err.message,
            });
            this.pub
              .publish(
                EventType.error_operation_fail,
                JSON.stringify({
                  type: EventType.error_operation_fail,
                  payload: {
                    quoteId: (event.payload as any)?.quoteId || "unknown",
                    stage: "event_handler",
                    error: err.message,
                    attempts: 1,
                  },
                }),
              )
              .catch(() => {});
          });
        }
      });
    }
  }

  async disconnect(): Promise<void> {
    await this.pub.quit();
    await this.sub.quit();
    log.info("disconnected");
  }
}

export function createEventBus(): IEventBus {
  if (process.env.REDIS_URL) {
    console.log("[EventBus] Using Redis event bus: %s", process.env.REDIS_URL);
    return new RedisEventBus();
  }
  console.log("[EventBus] Using InMemory event bus");
  return new InMemoryEventBus();
}
