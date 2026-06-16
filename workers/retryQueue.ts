import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

export function retryQueue(dataService: IDataService, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.admin_retry_command, async (event) => {
    if (event.type !== EventType.admin_retry_command) return;
    const { quoteId } = event.payload;

    const quote = await dataService.getQuote(quoteId);
    if (!quote) return;

    if (quote.formSubmitted && quote.formData && quote.email) {
      await eventBus.publish({
        type: EventType.init_quote_form_upload,
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
          type: EventType.init_quote_part_2d_file_upload,
          payload: {
            quoteId: quote.quoteId,
            partId: part.partId,
            fileKey: part.file2DKey,
            fileName: part.file2DName || part.name,
          },
        });
      }

      if (part.file3DKey) {
        await eventBus.publish({
          type: EventType.init_quote_part_3d_file_upload,
          payload: {
            quoteId: quote.quoteId,
            partId: part.partId,
            fileKey: part.file3DKey,
            fileName: part.file3DName || part.name,
          },
        });
      }

      await dataService.markRetryStatus(quoteId, part.partId, "RETRIED");
    }
  });
}
