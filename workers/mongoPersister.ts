import type { IDataService } from "../core/ports/IDataService";
import type { IEventBus } from "../core/ports/IEventBus";
import { EventType } from "../core/events/types";
import type { QuoteEvent } from "../core/events/types";
import { Logger } from "../core/telemetry/logger";
import { DatabaseError } from "../core/errors";

const log = new Logger({ component: "mongoPersister" });
const BATCH_WINDOW_MS = parseInt(process.env.MONGO_BATCH_WINDOW_MS || "500", 10);

type HandlerFn = (event: QuoteEvent) => Promise<void>;

interface PendingWrite {
  sets: Record<string, any>;
  arrayFilters: Map<string, Record<string, any>>;
  timer: ReturnType<typeof setTimeout> | null;
  flushPromise: Promise<void>;
  flushResolve: (() => void) | null;
  hasUploadData: boolean;
  uploadTypes: string[];
}

function handleSafe(fn: HandlerFn, eventBus: IEventBus): HandlerFn {
  return async (event) => {
    const start = performance.now();
    try {
      await fn(event);
      log.debug("persisted", { eventType: event.type, traceId: event.traceId, durationMs: Math.round(performance.now() - start) });
    } catch (error: any) {
      const dbError = error instanceof DatabaseError ? error : new DatabaseError(event.type, error instanceof Error ? error : new Error(String(error)));
      log.error("persist failed", {
        eventType: event.type,
        traceId: event.traceId,
        error: dbError.message,
        code: dbError.code,
        durationMs: Math.round(performance.now() - start),
      });
      try {
        await eventBus.publish({
          type: EventType.error_operation_fail,
          payload: {
            quoteId: (event.payload as any)?.quoteId || "unknown",
            stage: "mongoPersister",
            error: dbError.message,
            attempts: 1,
          },
          traceId: event.traceId,
        });
      } catch {}
    }
  };
}

export function mongoPersister(dataService: IDataService, eventBus: IEventBus): void {
  const safe = (fn: HandlerFn) => handleSafe(fn, eventBus);
  const buffer = new Map<string, PendingWrite>();
  const formProcessed = new Set<string>();
  const fileUploadProcessed = new Set<string>();

  function ensureBuffer(quoteId: string): PendingWrite {
    let entry = buffer.get(quoteId);
    if (!entry) {
      let flushResolve: (() => void) | null = null;
      const flushPromise = new Promise<void>((resolve) => { flushResolve = resolve; });
      entry = { sets: {}, arrayFilters: new Map(), timer: null, flushPromise, flushResolve, hasUploadData: false, uploadTypes: [] };
      buffer.set(quoteId, entry);
    }
    return entry;
  }

  function addToBuffer(quoteId: string, set: Record<string, any>, arrayFilter?: Record<string, any>): void {
    const entry = ensureBuffer(quoteId);
    Object.assign(entry.sets, set);
    if (arrayFilter) {
      const partId = arrayFilter["elem.partId"] as string;
      entry.arrayFilters.set(partId, arrayFilter);
    }
  }

  function scheduleFlush(quoteId: string): Promise<void> {
    const entry = buffer.get(quoteId);
    if (!entry) return Promise.resolve();
    if (entry.timer) clearTimeout(entry.timer);

    entry.timer = setTimeout(() => {
      flushBuffer(quoteId);
    }, BATCH_WINDOW_MS);

    return entry.flushPromise;
  }

  async function flushBuffer(quoteId: string): Promise<void> {
    const entry = buffer.get(quoteId);
    if (!entry) return;
    buffer.delete(quoteId);

    const sets = { ...entry.sets };
    const filters = [...entry.arrayFilters.values()];
    const hasUploadData = entry.hasUploadData;

    if (Object.keys(sets).length === 0 && filters.length === 0) {
      entry.flushResolve?.();
      return;
    }

    try {
      await dataService.batchUpdate(
        quoteId,
        sets as Record<string, unknown>,
        filters.length > 0 ? filters as Record<string, unknown>[] : undefined,
      );
      for (const uploadType of entry.uploadTypes) {
        if (uploadType === "form") {
          formProcessed.add(quoteId);
        } else {
          fileUploadProcessed.add(uploadType);
        }
      }
    } catch (error: any) {
      const dbError = error instanceof DatabaseError ? error : new DatabaseError("flushBuffer", error instanceof Error ? error : new Error(String(error)));
      log.error("batch flush failed", { quoteId, error: dbError.message });
      try {
        await eventBus.publish({
          type: EventType.error_operation_fail,
          payload: { quoteId, stage: "batch_flush", error: dbError.message, attempts: 1 },
        });
      } catch {}
    } finally {
      entry.flushResolve?.();
    }

    if (hasUploadData) {
      await checkAndTransitionCompleteness(quoteId);
    }
  }

  async function checkAndTransitionCompleteness(quoteId: string): Promise<void> {
    try {
      const quote = await dataService.getQuote(quoteId);
      if (!quote) return;
      if (quote.status === "QUOTE_DATA_NORMALIZATION_BEGIN") return;
      if (!quote.formSubmitted) return;

      const parts = quote.parts || [];
      if (parts.length === 0) return;
      const allPartsReady = parts.every((p: any) => p.file2DUploaded && p.file3DUploaded);
      if (!allPartsReady) return;

      await dataService.updateQuoteStatus(quoteId, "QUOTE_DATA_NORMALIZATION_BEGIN");
      await eventBus.publish({
        type: EventType.quote_data_normalization_begin,
        payload: { quoteId },
      });
      await eventBus.publish({
        type: EventType.quote_all_mandatory_data_receipt,
        payload: { quoteId, receivedAt: new Date().toISOString() },
      });
    } catch (error: any) {
      log.error("completeness check failed", { quoteId, error: error.message });
    }
  }

  // ── Non-batched operations ──

  eventBus.subscribe(EventType.init_quote_creation_request, safe(async (event) => {
    if (event.type !== EventType.init_quote_creation_request) return;
    const existing = await dataService.getQuote(event.payload.quoteId);
    if (existing) return;
    await dataService.createQuote({
      quoteId: event.payload.quoteId,
      parts: event.payload.parts,
    });
  }));

  eventBus.subscribe(EventType.error_operation_fail, safe(async (event) => {
    if (event.type !== EventType.error_operation_fail) return;
    if (event.payload.stage?.startsWith("mongoPersister")) return;
    await dataService.addToRetryQueue({
      quoteId: event.payload.quoteId,
      partId: event.payload.partId,
      stage: event.payload.stage,
      error: event.payload.error,
      attempts: event.payload.attempts,
      status: "PENDING",
    });
  }));

  eventBus.subscribe(EventType.quote_cancel, safe(async (event) => {
    if (event.type !== EventType.quote_cancel) return;
    await dataService.cancelQuote(event.payload.quoteId);
  }));

  // ── Batched quote updates ──

  eventBus.subscribe(EventType.init_quote_form_upload, async (event) => {
    if (event.type !== EventType.init_quote_form_upload) return;
    if (formProcessed.has(event.payload.quoteId)) return;
    const entry = ensureBuffer(event.payload.quoteId);
    entry.hasUploadData = true;
    entry.uploadTypes.push("form");
    addToBuffer(event.payload.quoteId, {
      formData: event.payload.formData,
      email: event.payload.email,
      formSubmitted: true,
    });
    await scheduleFlush(event.payload.quoteId);
  });

  eventBus.subscribe(EventType.init_quote_part_2d_file_upload, async (event) => {
    if (event.type !== EventType.init_quote_part_2d_file_upload) return;
    const { quoteId, partId, fileKey, fileName } = event.payload;
    const uploadKey = `${quoteId}_${partId}_2d`;
    if (fileUploadProcessed.has(uploadKey)) return;
    const entry = ensureBuffer(quoteId);
    entry.hasUploadData = true;
    entry.uploadTypes.push(uploadKey);
    const set: Record<string, any> = {};
    set[`parts.$[elem].file2DKey`] = fileKey;
    set[`parts.$[elem].file2DUploaded`] = true;
    if (fileName) set[`parts.$[elem].file2DName`] = fileName;
    addToBuffer(quoteId, set, { "elem.partId": partId });
    await scheduleFlush(quoteId);
  });

  eventBus.subscribe(EventType.init_quote_part_3d_file_upload, async (event) => {
    if (event.type !== EventType.init_quote_part_3d_file_upload) return;
    const { quoteId, partId, fileKey, fileName } = event.payload;
    const uploadKey = `${quoteId}_${partId}_3d`;
    if (fileUploadProcessed.has(uploadKey)) return;
    const entry = ensureBuffer(quoteId);
    entry.hasUploadData = true;
    entry.uploadTypes.push(uploadKey);
    const set: Record<string, any> = {};
    set[`parts.$[elem].file3DKey`] = fileKey;
    set[`parts.$[elem].file3DUploaded`] = true;
    if (fileName) set[`parts.$[elem].file3DName`] = fileName;
    addToBuffer(quoteId, set, { "elem.partId": partId });
    await scheduleFlush(quoteId);
  });

  function addPartStage(
    quoteId: string, partId: string, stage: string,
    output: Record<string, unknown> | null, error?: string, retries?: number,
  ): Promise<void> {
    const prefix = `processing.${partId}.${stage}`;

    const set: Record<string, any> = {};
    set[`${prefix}.processed`] = true;
    if (output !== undefined) set[`${prefix}.output`] = output;
    if (error !== undefined) set[`${prefix}.error`] = error;
    if (retries !== undefined) set[`${prefix}.retries`] = retries;

    addToBuffer(quoteId, set);
    return scheduleFlush(quoteId);
  }

  eventBus.subscribe(EventType.part_form_complete, async (event) => {
    if (event.type !== EventType.part_form_complete) return;
    await addPartStage(event.payload.quoteId, event.payload.partId, "form", event.payload.output, event.payload.error, event.payload.retries);
  });

  eventBus.subscribe(EventType.part_2d_complete, async (event) => {
    if (event.type !== EventType.part_2d_complete) return;
    await addPartStage(event.payload.quoteId, event.payload.partId, "2d", event.payload.output, event.payload.error, event.payload.retries);
  });

  eventBus.subscribe(EventType.part_3d_complete, async (event) => {
    if (event.type !== EventType.part_3d_complete) return;
    await addPartStage(event.payload.quoteId, event.payload.partId, "3d", event.payload.output, event.payload.error, event.payload.retries);
  });

  eventBus.subscribe(EventType.quote_data_normalization_complete, async (event) => {
    if (event.type !== EventType.quote_data_normalization_complete) return;
    addToBuffer(event.payload.quoteId, {
      status: "QUOTE_INFO_COMPLETE",
      completionStatus: event.payload.completionStatus,
    });
    await scheduleFlush(event.payload.quoteId);
  });

  eventBus.subscribe(EventType.quote_data_normalization_timed_out, async (event) => {
    if (event.type !== EventType.quote_data_normalization_timed_out) return;
    addToBuffer(event.payload.quoteId, {
      status: "QUOTE_TIMED_OUT",
      timeoutAt: event.payload.timeoutAt,
    });
    await scheduleFlush(event.payload.quoteId);
  });

  eventBus.subscribe(EventType.quote_ready, async (event) => {
    if (event.type !== EventType.quote_ready) return;
    const completionStatus = event.payload.generatedData?.completionStatus || "COMPLETE";
    addToBuffer(event.payload.quoteId, {
      status: "QUOTE_DATA_READY",
      generatedData: event.payload.generatedData,
      transparency: event.payload.transparency,
      completionStatus,
    });
    await scheduleFlush(event.payload.quoteId);
  });

  eventBus.subscribe(EventType.quote_pdf_complete, async (event) => {
    if (event.type !== EventType.quote_pdf_complete) return;
    addToBuffer(event.payload.quoteId, {
      pdfKey: event.payload.pdfKey,
      pdfUrl: event.payload.pdfUrl,
    });
    await scheduleFlush(event.payload.quoteId);
  });

  eventBus.subscribe(EventType.quote_email_send, async (event) => {
    if (event.type !== EventType.quote_email_send) return;
    addToBuffer(event.payload.quoteId, {
      emailSent: true,
      emailSentAt: event.payload.sentAt,
    });
    await scheduleFlush(event.payload.quoteId);
  });

  eventBus.subscribe(EventType.quote_notification_send, async (event) => {
    if (event.type !== EventType.quote_notification_send) return;
    addToBuffer(event.payload.quoteId, {
      notificationChannel: event.payload.channel,
    });
    await scheduleFlush(event.payload.quoteId);
  });
}
