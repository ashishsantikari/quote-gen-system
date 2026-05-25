import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import type { QuoteEvent } from "../core/events/types";
import { Logger } from "../core/telemetry/logger";

const log = new Logger({ component: "mongoPersister" });

type HandlerFn = (event: QuoteEvent) => Promise<void>;

function handleSafe(fn: HandlerFn): HandlerFn {
  return async (event) => {
    const start = performance.now();
    try {
      await fn(event);
      log.debug("persisted", { eventType: event.type, traceId: event.traceId, durationMs: Math.round(performance.now() - start) });
    } catch (error: any) {
      log.error("persist failed", { eventType: event.type, traceId: event.traceId, error: error.message, durationMs: Math.round(performance.now() - start) });
    }
  };
}

export function mongoPersister(dataService: IDataService, eventBus: IEventBus): void {
  eventBus.subscribe(EventType.QuoteCreated, handleSafe(async (event) => {
    if (event.type !== EventType.QuoteCreated) return;
    await dataService.createQuote({
      quoteId: event.payload.quoteId,
      parts: event.payload.parts,
    });
  }));

  eventBus.subscribe(EventType.FormUploaded, handleSafe(async (event) => {
    if (event.type !== EventType.FormUploaded) return;
    await dataService.submitForm(
      event.payload.quoteId,
      event.payload.formData,
      event.payload.email
    );
  }));

  eventBus.subscribe(EventType.FileUploaded, handleSafe(async (event) => {
    if (event.type !== EventType.FileUploaded) return;
    await dataService.markPartFileUploaded(
      event.payload.quoteId,
      event.payload.partId,
      event.payload.fileType
    );
  }));

  eventBus.subscribe(EventType.PartFormProcessed, handleSafe(async (event) => {
    if (event.type !== EventType.PartFormProcessed) return;
    await dataService.updatePartStage(
      event.payload.quoteId, event.payload.partId, "form",
      event.payload.output, event.payload.error, event.payload.retries
    );
  }));

  eventBus.subscribe(EventType.Part2DProcessed, handleSafe(async (event) => {
    if (event.type !== EventType.Part2DProcessed) return;
    await dataService.updatePartStage(
      event.payload.quoteId, event.payload.partId, "2d",
      event.payload.output, event.payload.error, event.payload.retries
    );
  }));

  eventBus.subscribe(EventType.Part3DProcessed, handleSafe(async (event) => {
    if (event.type !== EventType.Part3DProcessed) return;
    await dataService.updatePartStage(
      event.payload.quoteId, event.payload.partId, "3d",
      event.payload.output, event.payload.error, event.payload.retries
    );
  }));

  eventBus.subscribe(EventType.QuoteInfoComplete, handleSafe(async (event) => {
    if (event.type !== EventType.QuoteInfoComplete) return;
    await dataService.updateQuoteStatus(
      event.payload.quoteId, "QUOTE_INFO_COMPLETE",
      { completionStatus: event.payload.completionStatus }
    );
  }));

  eventBus.subscribe(EventType.QuoteTimedOut, handleSafe(async (event) => {
    if (event.type !== EventType.QuoteTimedOut) return;
    await dataService.updateQuoteStatus(
      event.payload.quoteId, "QUOTE_TIMED_OUT",
      { timeoutAt: event.payload.timeoutAt }
    );
  }));

  eventBus.subscribe(EventType.QuoteGenerated, handleSafe(async (event) => {
    if (event.type !== EventType.QuoteGenerated) return;
    await dataService.updateQuoteStatus(
      event.payload.quoteId, "QUOTE_INFO_COMPLETE",
      { generatedData: event.payload.generatedData, transparency: event.payload.transparency, completionStatus: "COMPLETE" }
    );
  }));

  eventBus.subscribe(EventType.PdfGenerated, handleSafe(async (event) => {
    if (event.type !== EventType.PdfGenerated) return;
    await dataService.updateQuoteStatus(
      event.payload.quoteId, "QUOTE_INFO_COMPLETE",
      { pdfKey: event.payload.pdfKey, pdfUrl: event.payload.pdfUrl }
    );
  }));

  eventBus.subscribe(EventType.EmailSent, handleSafe(async (event) => {
    if (event.type !== EventType.EmailSent) return;
    await dataService.markEmailSent(event.payload.quoteId);
  }));

  eventBus.subscribe(EventType.NotificationSent, handleSafe(async (event) => {
    if (event.type !== EventType.NotificationSent) return;
    await dataService.updateQuoteStatus(
      event.payload.quoteId, "QUOTE_INFO_COMPLETE",
      { notificationChannel: event.payload.channel }
    );
  }));

  eventBus.subscribe(EventType.OperationFailed, handleSafe(async (event) => {
    if (event.type !== EventType.OperationFailed) return;
    await dataService.addToRetryQueue({
      quoteId: event.payload.quoteId,
      partId: event.payload.partId || "",
      stage: event.payload.stage || "",
      error: event.payload.error,
      attempts: event.payload.attempts,
      status: "PENDING",
    });
  }));

  eventBus.subscribe(EventType.QuoteCancelled, handleSafe(async (event) => {
    if (event.type !== EventType.QuoteCancelled) return;
    await dataService.cancelQuote(event.payload.quoteId);
  }));
}
