import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";

process.env.MONGO_BATCH_WINDOW_MS = "0";
const { mongoPersister } = await import("../../workers/mongoPersister");

function createMockDataService(overrides?: Partial<IDataService>): IDataService {
  return {
    createQuote: mock(() => Promise.resolve({})),
    getQuote: mock(() => Promise.resolve(null)),
    submitForm: mock(() => Promise.resolve()),
    markPartFileUploaded: mock(() => Promise.resolve()),
    updatePartStage: mock(() => Promise.resolve()),
    updatePartPresignedUrls: mock(() => Promise.resolve()),
    updateQuoteStatus: mock(() => Promise.resolve()),
    markEmailSent: mock(() => Promise.resolve()),
    cancelQuote: mock(() => Promise.resolve()),
    findExpiredQuotes: mock(() => Promise.resolve([])),
    getQuoteStatus: mock(() => Promise.resolve(null)),
    isPartStageProcessed: mock(() => Promise.resolve(false)),
    addToRetryQueue: mock(() => Promise.resolve()),
    getRetryQueue: mock(() => Promise.resolve([])),
    markRetryStatus: mock(() => Promise.resolve()),
    batchUpdate: mock(() => Promise.resolve()),
    ...overrides,
  };
}

function createMockEventBus(): IEventBus & { getPublished(): any[] } {
  const handlers = new Map<string, Set<(event: any) => Promise<void>>>();
  const published: any[] = [];

  return {
    async publish(event: any) {
      published.push({ type: event.type, payload: { ...event.payload } });
      const subs = handlers.get(event.type);
      if (subs) {
        await Promise.all([...subs].map((h) => h(event)));
      }
    },
    subscribe(eventType: string, handler: (event: any) => Promise<void>) {
      if (!handlers.has(eventType)) handlers.set(eventType, new Set());
      handlers.get(eventType)!.add(handler);
    },
    getPublished() {
      return published;
    },
  };
}

// ── Non-batched operations ──

test("QuoteCreated → calls createQuote", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_creation_request,
    payload: { quoteId: "q1", parts: [{ partId: "p1", name: "engine" }] },
  });

  expect((dataService.createQuote as any).mock.calls.length).toBe(1);
  expect((dataService.createQuote as any).mock.calls[0][0].quoteId).toBe("q1");
});

test("QuoteCreated skips if quote already exists", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({ quoteId: "q1" })),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_creation_request,
    payload: { quoteId: "q1", parts: [{ partId: "p1", name: "engine" }] },
  });

  expect((dataService.createQuote as any).mock.calls.length).toBe(0);
});

test("OperationFailed → calls addToRetryQueue", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.error_operation_fail,
    payload: { quoteId: "q1", partId: "p1", stage: "2d", error: "timeout", attempts: 3 },
  });

  expect((dataService.addToRetryQueue as any).mock.calls.length).toBe(1);
  expect((dataService.addToRetryQueue as any).mock.calls[0][0].status).toBe("PENDING");
});

test("QuoteCancelled → calls cancelQuote", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.quote_cancel,
    payload: { quoteId: "q1", reason: "EXPIRED" },
  });

  expect((dataService.cancelQuote as any).mock.calls.length).toBe(1);
});

// ── Batched operations ──

test("FormUploaded → flushes via batchUpdate", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_form_upload,
    payload: { quoteId: "q1", formData: { color: "red" }, email: "test@example.com" },
  });

  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets.formData).toEqual({ color: "red" });
  expect(sets.email).toBe("test@example.com");
  expect(sets.formSubmitted).toBe(true);
});

test("File2DUploaded → flushes file key and upload flag via batchUpdate", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_part_2d_file_upload,
    payload: { quoteId: "q1", partId: "p1", fileKey: "quotes/q1/parts/p1/2d/engine.stl", fileName: "engine.stl" },
  });
  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets["parts.$[elem].file2DKey"]).toBe("quotes/q1/parts/p1/2d/engine.stl");
  expect(sets["parts.$[elem].file2DUploaded"]).toBe(true);
  expect(sets["parts.$[elem].file2DName"]).toBe("engine.stl");
});

test("File3DUploaded → flushes file key and upload flag via batchUpdate", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_part_3d_file_upload,
    payload: { quoteId: "q1", partId: "p1", fileKey: "quotes/q1/parts/p1/3d/engine.stl", fileName: "engine.stl" },
  });
  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets["parts.$[elem].file3DKey"]).toBe("quotes/q1/parts/p1/3d/engine.stl");
  expect(sets["parts.$[elem].file3DUploaded"]).toBe(true);
  expect(sets["parts.$[elem].file3DName"]).toBe("engine.stl");
});

test("PartFormProcessed → queues stage output via batchUpdate", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId: "q1", partId: "p1", output: { result: "ok" } },
  });
  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets["processing.p1.form.processed"]).toBe(true);
  expect(sets["processing.p1.form.output"]).toEqual({ result: "ok" });
});

test("PartFormProcessed with error → passes error to batchUpdate", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId: "q1", partId: "p1", output: null, error: "parse failure", retries: 3 },
  });
  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets["processing.p1.form.output"]).toBeNull();
  expect(sets["processing.p1.form.error"]).toBe("parse failure");
  expect(sets["processing.p1.form.retries"]).toBe(3);
});

test("QuoteInfoComplete → flushes status via batchUpdate", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.quote_data_normalization_complete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE" },
  });
  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets.status).toBe("QUOTE_INFO_COMPLETE");
  expect(sets.completionStatus).toBe("COMPLETE");
});

test("EmailSent → flushes via batchUpdate", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.quote_email_send,
    payload: { quoteId: "q1", sentAt: "2024-01-01T00:00:00Z" },
  });
  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets.emailSent).toBe(true);
  expect(sets.emailSentAt).toBe("2024-01-01T00:00:00Z");
});

test("multiple events for same quote → merged into single batchUpdate", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(null)),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await Promise.all([
    eventBus.publish({
      type: EventType.init_quote_form_upload,
      payload: { quoteId: "q1", formData: {}, email: "t@e.com" },
    }),
    eventBus.publish({
      type: EventType.init_quote_part_2d_file_upload,
      payload: { quoteId: "q1", partId: "p1", fileKey: "quotes/q1/parts/p1/2d/model.stl", fileName: "model.stl" },
    }),
    eventBus.publish({
      type: EventType.init_quote_part_3d_file_upload,
      payload: { quoteId: "q1", partId: "p1", fileKey: "quotes/q1/parts/p1/3d/model.stl", fileName: "model.stl" },
    }),
  ]);

  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
  const sets = (dataService.batchUpdate as any).mock.calls[0][1];
  expect(sets.formSubmitted).toBe(true);
  expect(sets["parts.$[elem].file2DKey"]).toBe("quotes/q1/parts/p1/2d/model.stl");
  expect(sets["parts.$[elem].file3DKey"]).toBe("quotes/q1/parts/p1/3d/model.stl");
});

test("handles errors gracefully in batch flush", async () => {
  const dataService = createMockDataService({
    batchUpdate: mock(() => Promise.reject(new Error("flush failed"))),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_form_upload,
    payload: { quoteId: "q1", formData: {}, email: "t@e.com" },
  });

  const opFailEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.error_operation_fail
  );
  expect(opFailEvents.length).toBeGreaterThanOrEqual(1);
});

// ── Completeness check after flush ──

test("after form+2D+3D flush, transitions to QUOTE_DATA_NORMALIZATION_BEGIN and publishes events", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      status: "QUOTE_INIT",
      formSubmitted: true,
      parts: [
        { partId: "p1", file2DUploaded: true, file3DUploaded: true },
      ],
    })),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_part_2d_file_upload,
    payload: { quoteId: "q1", partId: "p1", fileKey: "k2d", fileName: "f.stl" },
  });

  // Verify batch update happened
  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);

  // Verify status transition
  const statusCalls = (dataService.updateQuoteStatus as any).mock.calls;
  expect(statusCalls.length).toBe(1);
  expect(statusCalls[0][0]).toBe("q1");
  expect(statusCalls[0][1]).toBe("QUOTE_DATA_NORMALIZATION_BEGIN");

  // Verify events published
  const normBegin = eventBus.getPublished().find((e: any) => e.type === EventType.quote_data_normalization_begin);
  expect(normBegin).toBeTruthy();
  expect(normBegin.payload.quoteId).toBe("q1");

  const allData = eventBus.getPublished().find((e: any) => e.type === EventType.quote_all_mandatory_data_receipt);
  expect(allData).toBeTruthy();
  expect(allData.payload.quoteId).toBe("q1");
  expect(typeof allData.payload.receivedAt).toBe("string");
});

test("does NOT transition if form not yet submitted", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      status: "QUOTE_INIT",
      formSubmitted: false,
      parts: [
        { partId: "p1", file2DUploaded: true, file3DUploaded: true },
      ],
    })),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_part_3d_file_upload,
    payload: { quoteId: "q1", partId: "p1", fileKey: "k3d", fileName: "f.stl" },
  });

  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(0);
});

test("does NOT transition if not all parts have 2D/3D files", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      status: "QUOTE_INIT",
      formSubmitted: true,
      parts: [
        { partId: "p1", file2DUploaded: true, file3DUploaded: false },
        { partId: "p2", file2DUploaded: true, file3DUploaded: true },
      ],
    })),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_form_upload,
    payload: { quoteId: "q1", formData: {}, email: "t@e.com" },
  });

  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(0);
});

test("idempotent — skips if already QUOTE_DATA_NORMALIZATION_BEGIN", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      status: "QUOTE_DATA_NORMALIZATION_BEGIN",
      formSubmitted: true,
      parts: [
        { partId: "p1", file2DUploaded: true, file3DUploaded: true },
      ],
    })),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.init_quote_part_2d_file_upload,
    payload: { quoteId: "q1", partId: "p1", fileKey: "k2d", fileName: "f.stl" },
  });

  // updateQuoteStatus should NOT be called again
  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(0);
});

test("completeness check handles getQuote error gracefully", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.reject(new Error("DB down"))),
    batchUpdate: mock(() => Promise.resolve()),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  // Should not throw — error is swallowed by checkAndTransitionCompleteness
  await eventBus.publish({
    type: EventType.init_quote_form_upload,
    payload: { quoteId: "q1", formData: {}, email: "t@e.com" },
  });

  expect((dataService.batchUpdate as any).mock.calls.length).toBe(1);
});

test("non-upload events do NOT trigger completeness check", async () => {
  const getQuoteCalled: string[] = [];
  const dataService = createMockDataService({
    getQuote: mock(() => { getQuoteCalled.push("getQuote"); return Promise.resolve(null); }),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  // PartFormProcessed is not an upload event — no completeness check
  await eventBus.publish({
    type: EventType.part_form_complete,
    payload: { quoteId: "q1", partId: "p1", output: { result: "ok" } },
  });

  expect(getQuoteCalled.length).toBe(0);
});
