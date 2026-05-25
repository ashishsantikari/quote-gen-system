import type { IDataService } from "../core/ports/IDataService";
import type { IFileStorage } from "../core/ports/IFileStorage";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import { withRetry } from "../core/infra/retry";
import { CircuitBreaker } from "../core/infra/circuitBreaker";
import { S3_BUCKET } from "../core/ids";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "threeDProcessor" });
const cb = new CircuitBreaker({
  name: "threeDProcessor",
  ...(process.env.CB_OPEN_FOREVER === "true" ? { failureThreshold: 1, openTimeoutMs: Infinity } : {}),
});

export function threeDProcessor(
  dataService: IDataService,
  fileStorage: IFileStorage,
  eventBus: IEventBus
): void {
  eventBus.subscribe(EventType.quote_all_mandatory_data_receipt, async (event) => {
    if (event.type !== EventType.quote_all_mandatory_data_receipt) return;

    const { quoteId } = event.payload;
    const meta = { quoteId, traceId: event.traceId };
    const quote = await dataService.getQuote(quoteId);
    if (!quote) { log.warn("quote not found", meta); return; }
    log.info("processing 3D files", meta);

    for (const part of quote.parts) {
      const fileKey = part.file3DKey;
      if (!fileKey) continue;

      const partId = part.partId;
      await withRetry(
        async () => {
          await cb.execute(async () => {
            const exists = await fileStorage.fileExists(S3_BUCKET, fileKey);
            if (!exists) throw new Error(`File not found in bucket '${S3_BUCKET}': ${fileKey} (quoteId=${quoteId}, partId=${partId})`);

            const output = {
              processed: true,
              fileKey,
              bucket: S3_BUCKET,
              processedAt: new Date().toISOString(),
            };

            await eventBus.publish({
              type: EventType.part_3d_complete,
              payload: { quoteId, partId, output },
              traceId: event.traceId,
            });
          });
        },
        {
          maxAttempts: 3,
          shouldSkip: () => dataService.isPartStageProcessed(quoteId, partId, "3d"),
        }
      ).catch(async (error: any) => {
        log.warn("3D processing failed", { quoteId, partId, fileKey, traceId: event.traceId, error: error.message });
        await eventBus.publish({
          type: EventType.part_3d_complete,
          payload: { quoteId, partId, output: null, error: error.message, retries: 3 },
          traceId: event.traceId,
        });
        await eventBus.publish({
          type: EventType.error_operation_fail,
          payload: { quoteId, partId, stage: "3d", error: error.message, attempts: 3 },
          traceId: event.traceId,
        });
      });
    }
  });
}
