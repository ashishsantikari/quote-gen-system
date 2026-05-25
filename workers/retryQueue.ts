import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

export function retryQueue(dataService: IDataService, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.RetryCommand, async (event) => {
    if (event.type !== EventType.RetryCommand) return;
    const { quoteId } = event.payload;

    const quote = await dataService.getQuote(quoteId);
    if (!quote) return;

    if (quote.formSubmitted && quote.formData && quote.email) {
      await eventBus.publish({
        type: EventType.FormUploaded,
        payload: {
          quoteId: quote.quoteId,
          formData: quote.formData,
          email: quote.email,
        },
      });
    }

    for (const part of quote.parts || []) {
      if (part.file2DKey) {
        await eventBus.publish({
          type: EventType.FileUploaded,
          payload: {
            quoteId: quote.quoteId,
            partId: part.partId,
            fileType: "2d",
            fileKey: part.file2DKey,
          },
        });
      }

      if (part.file3DKey) {
        await eventBus.publish({
          type: EventType.FileUploaded,
          payload: {
            quoteId: quote.quoteId,
            partId: part.partId,
            fileType: "3d",
            fileKey: part.file3DKey,
          },
        });
      }

      await dataService.markRetryStatus(quoteId, part.partId, "RETRIED");
    }
  });
}
