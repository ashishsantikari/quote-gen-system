import type { IFileStorage } from "../core/ports/IFileStorage";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";

export function pdfGenerator(fileStorage: IFileStorage, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.QuoteGenerated, async (event) => {
    if (event.type !== EventType.QuoteGenerated) return;
    const { quoteId, generatedData, transparency } = event.payload;

    const pdfKey = `quotes/${quoteId}/output/quote.pdf`;
    const bucket = process.env.S3_BUCKET || "quotes";

    const pdfUrl = await fileStorage.generatePresignedUrl(bucket, pdfKey, 3600);

    await eventBus.publish({
      type: EventType.PdfGenerated,
      payload: { quoteId, pdfKey, pdfUrl },
    });
  });
}
