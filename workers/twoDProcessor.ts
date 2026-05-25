import type { IDataService } from "../core/ports/IDataService";
import type { IFileStorage } from "../core/ports/IFileStorage";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import { withRetry } from "../core/infra/retry";
import { CircuitBreaker } from "../core/infra/circuitBreaker";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "twoDProcessor" });
const cb = new CircuitBreaker();

export function twoDProcessor(
  dataService: IDataService,
  fileStorage: IFileStorage,
  eventBus: IEventBus
): void {
  eventBus.subscribe(EventType.FileUploaded, async (event) => {
    if (event.type !== EventType.FileUploaded) return;
    if (event.payload.fileType !== "2d") return;

    const { quoteId, partId, fileKey } = event.payload;
    const bucket = process.env.S3_BUCKET || "quotes";
    const meta = { quoteId, partId, fileKey, traceId: event.traceId };
    log.info("processing 2D file", meta);

    await withRetry(
      async () => {
        await cb.execute(async () => {
          const exists = await fileStorage.fileExists(bucket, fileKey);
          if (!exists) throw new Error(`File not found: ${fileKey}`);

          const output = {
            processed: true,
            fileKey,
            processedAt: new Date().toISOString(),
          };

          await eventBus.publish({
            type: EventType.Part2DProcessed,
            payload: { quoteId, partId, output },
            traceId: event.traceId,
          });
        });
      },
      {
        maxAttempts: 3,
        shouldSkip: () => dataService.isPartStageProcessed(quoteId, partId, "2d"),
      }
    ).catch(async (error: any) => {
      log.warn("2D processing failed", { ...meta, error: error.message });
      await eventBus.publish({
        type: EventType.Part2DProcessed,
        payload: { quoteId, partId, output: null, error: error.message, retries: 3 },
        traceId: event.traceId,
      });
      await eventBus.publish({
        type: EventType.OperationFailed,
        payload: { quoteId, partId, stage: "2d", error: error.message, attempts: 3 },
        traceId: event.traceId,
      });
    });
  });
}
