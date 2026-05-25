import type { IDataService } from "../core/ports/IDataService";
import type { IFileStorage } from "../core/ports/IFileStorage";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import { withRetry } from "../core/infra/retry";

export function cleanupWorker(
  dataService: IDataService,
  fileStorage: IFileStorage,
  eventBus: IEventBus,
  expiryHours: number = 24
): void {
  const intervalMs = 10 * 60 * 1000; // 10 minutes

  const run = async () => {
    try {
      const expiredQuotes = await dataService.findExpiredQuotes(expiryHours);
      const bucket = process.env.S3_BUCKET || "quotes";

      for (const quote of expiredQuotes) {
        const keys: string[] = [];

        for (const part of quote.parts || []) {
          if (part.file2DKey) keys.push(part.file2DKey);
          if (part.file3DKey) keys.push(part.file3DKey);
        }

        if (keys.length > 0) {
          await withRetry(
            async () => {
              await fileStorage.deleteFiles(bucket, keys);
            },
            { maxAttempts: 3 }
          );
        }

        await eventBus.publish({
          type: EventType.QuoteCancelled,
          payload: { quoteId: quote.quoteId, reason: "EXPIRED" },
        });
      }
    } catch (error) {
      console.error("[cleanupWorker] Error during cleanup:", error);
    }
  };

  run();
  setInterval(run, intervalMs);
}
