import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import type { Queue } from "bullmq";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "deadLetter" });

export function deadLetter(eventBus: IEventBus, dlq?: Queue): void {
  eventBus.subscribe(EventType.error_operation_fail, async (event) => {
    if (event.type !== EventType.error_operation_fail) return;

    const job = {
      quoteId: event.payload.quoteId,
      partId: event.payload.partId,
      stage: event.payload.stage,
      error: event.payload.error,
      attempts: event.payload.attempts,
      traceId: event.traceId,
    };

    if (dlq) {
      try {
        await dlq.add("error_operation_fail", job, {
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        });
      } catch (err: any) {
        log.error("failed to enqueue to DLQ", { error: err.message });
      }
    }
  });
}
