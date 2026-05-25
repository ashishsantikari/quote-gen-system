import type { IFileStorage } from "../core/ports/IFileStorage";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import { S3_BUCKET, buildPdfKey } from "../core/ids";

export function pdfGenerator(fileStorage: IFileStorage, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.quote_ready, async (event) => {
    if (event.type !== EventType.quote_ready) return;
    const { quoteId, generatedData, transparency } = event.payload;

    const pdfKey = buildPdfKey(quoteId);
    const pdfUrl = await fileStorage.generatePresignedUrl(S3_BUCKET, pdfKey, 3600);

    await eventBus.publish({
      type: EventType.quote_pdf_complete,
      payload: { quoteId, pdfKey, pdfUrl },
    });
  });
}
