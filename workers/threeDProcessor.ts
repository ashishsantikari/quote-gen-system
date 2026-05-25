import type { IDataService } from "../core/ports/IDataService";
import type { IFileStorage } from "../core/ports/IFileStorage";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import { withRetry } from "../core/infra/retry";
import { CircuitBreaker } from "../core/infra/circuitBreaker";

const cb = new CircuitBreaker();

export function threeDProcessor(
  dataService: IDataService,
  fileStorage: IFileStorage,
  eventBus: IEventBus
): void {
  eventBus.subscribe(EventType.FileUploaded, async (event) => {
    if (event.type !== EventType.FileUploaded) return;
    if (event.payload.fileType !== "3d") return;

    const { quoteId, partId, fileKey } = event.payload;
    const bucket = process.env.S3_BUCKET || "quotes";

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
            type: EventType.Part3DProcessed,
            payload: { quoteId, partId, output },
          });
        });
      },
      {
        maxAttempts: 3,
        shouldSkip: () => dataService.isPartStageProcessed(quoteId, partId, "3d"),
      }
    ).catch(async (error: any) => {
      await eventBus.publish({
        type: EventType.Part3DProcessed,
        payload: { quoteId, partId, output: null, error: error.message, retries: 3 },
      });
      await eventBus.publish({
        type: EventType.OperationFailed,
        payload: { quoteId, partId, stage: "3d", error: error.message, attempts: 3 },
      });
    });
  });
}
