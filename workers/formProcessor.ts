import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import { withRetry } from "../core/infra/retry";
import { CircuitBreaker } from "../core/infra/circuitBreaker";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "formProcessor" });
const cb = new CircuitBreaker({
  name: "formProcessor",
  ...(process.env.CB_OPEN_FOREVER === "true" ? { failureThreshold: 1, openTimeoutMs: Infinity } : {}),
});

export function formProcessor(dataService: IDataService, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.quote_all_mandatory_data_receipt, async (event) => {
    if (event.type !== EventType.quote_all_mandatory_data_receipt) return;

    const { quoteId } = event.payload;
    const meta = { quoteId, traceId: event.traceId, partCount: 0 };
    const quote = await dataService.getQuote(quoteId);
    if (!quote) { log.warn("quote not found", meta); return; }
    meta.partCount = quote.parts.length;
    log.info("processing form", meta);

    const formData = quote.formData || {};

    for (const part of quote.parts) {
      await withRetry(
        async () => {
          await cb.execute(async () => {
            const partFormData = formData[part.partId] || formData;
            const output = { processedForm: partFormData, processedAt: new Date().toISOString() };
            await eventBus.publish({
              type: EventType.part_form_complete,
              payload: { quoteId, partId: part.partId, output },
              traceId: event.traceId,
            });
          });
        },
        {
          maxAttempts: 3,
          shouldSkip: () => dataService.isPartStageProcessed(quoteId, part.partId, "form"),
        }
      ).catch(async (error: any) => {
        log.warn("processing failed, publishing error output", { quoteId, partId: part.partId, traceId: event.traceId, error: error.message });
        await eventBus.publish({
          type: EventType.part_form_complete,
          payload: { quoteId, partId: part.partId, output: null, error: error.message, retries: 3 },
          traceId: event.traceId,
        });
        await eventBus.publish({
          type: EventType.error_operation_fail,
          payload: { quoteId, partId: part.partId, stage: "form", error: error.message, attempts: 3 },
          traceId: event.traceId,
        });
      });
    }
  });
}
