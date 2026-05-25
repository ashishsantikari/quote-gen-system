import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { mongoPersister } from "../../workers/mongoPersister";

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

test("QuoteCreated → calls createQuote", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteCreated,
    payload: { quoteId: "q1", parts: [{ partId: "p1", name: "engine" }] },
  });

  expect((dataService.createQuote as any).mock.calls.length).toBe(1);
  expect((dataService.createQuote as any).mock.calls[0][0].quoteId).toBe("q1");
});

test("FormUploaded → calls submitForm", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.FormUploaded,
    payload: { quoteId: "q1", formData: { color: "red" }, email: "test@example.com" },
  });

  expect((dataService.submitForm as any).mock.calls.length).toBe(1);
});

test("FileUploaded → calls markPartFileUploaded", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.FileUploaded,
    payload: { quoteId: "q1", partId: "p1", fileType: "2d", fileKey: "key" },
  });

  expect((dataService.markPartFileUploaded as any).mock.calls.length).toBe(1);
});

test("PartFormProcessed → calls updatePartStage", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.PartFormProcessed,
    payload: { quoteId: "q1", partId: "p1", output: { result: "ok" } },
  });

  expect((dataService.updatePartStage as any).mock.calls.length).toBe(1);
  expect((dataService.updatePartStage as any).mock.calls[0][0]).toBe("q1");
  expect((dataService.updatePartStage as any).mock.calls[0][2]).toBe("form");
});

test("Part2DProcessed → calls updatePartStage for 2d", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.Part2DProcessed,
    payload: { quoteId: "q1", partId: "p1", output: { result: "ok" } },
  });

  expect((dataService.updatePartStage as any).mock.calls.length).toBe(1);
  expect((dataService.updatePartStage as any).mock.calls[0][2]).toBe("2d");
});

test("Part3DProcessed → calls updatePartStage for 3d", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.Part3DProcessed,
    payload: { quoteId: "q1", partId: "p1", output: { result: "ok" } },
  });

  expect((dataService.updatePartStage as any).mock.calls.length).toBe(1);
  expect((dataService.updatePartStage as any).mock.calls[0][2]).toBe("3d");
});

test("QuoteInfoComplete → calls updateQuoteStatus", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteInfoComplete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE" },
  });

  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(1);
  expect((dataService.updateQuoteStatus as any).mock.calls[0][1]).toBe("QUOTE_INFO_COMPLETE");
});

test("QuoteTimedOut → calls updateQuoteStatus", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteTimedOut,
    payload: { quoteId: "q1", completedParts: [], pendingParts: [], timeoutAt: new Date().toISOString() },
  });

  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(1);
  expect((dataService.updateQuoteStatus as any).mock.calls[0][1]).toBe("QUOTE_TIMED_OUT");
});

test("QuoteGenerated → calls updateQuoteStatus", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteGenerated,
    payload: {
      quoteId: "q1",
      generatedData: {},
      transparency: { totalStages: 3, successful: 3, errored: 0, timedOut: 0, dataCompleteness: "COMPLETE", assumptions: [] },
    },
  });

  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(1);
});

test("PdfGenerated → calls updateQuoteStatus", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.PdfGenerated,
    payload: { quoteId: "q1", pdfKey: "key", pdfUrl: "url" },
  });

  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(1);
});

test("EmailSent → calls markEmailSent", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.EmailSent,
    payload: { quoteId: "q1", sentAt: new Date().toISOString() },
  });

  expect((dataService.markEmailSent as any).mock.calls.length).toBe(1);
});

test("NotificationSent → calls updateQuoteStatus", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.NotificationSent,
    payload: { quoteId: "q1", channel: "websocket" },
  });

  expect((dataService.updateQuoteStatus as any).mock.calls.length).toBe(1);
});

test("OperationFailed → calls addToRetryQueue", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.OperationFailed,
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
    type: EventType.QuoteCancelled,
    payload: { quoteId: "q1", reason: "EXPIRED" },
  });

  expect((dataService.cancelQuote as any).mock.calls.length).toBe(1);
});

test("handles errors gracefully without throwing", async () => {
  const dataService = createMockDataService({
    createQuote: mock(() => Promise.reject(new Error("DB down"))),
  });
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteCreated,
    payload: { quoteId: "q1", parts: [{ partId: "p1", name: "engine" }] },
  });

  expect((dataService.createQuote as any).mock.calls.length).toBeGreaterThanOrEqual(1);
});

test("PartFormProcessed with error → passes error to updatePartStage", async () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();
  mongoPersister(dataService, eventBus);

  await eventBus.publish({
    type: EventType.PartFormProcessed,
    payload: { quoteId: "q1", partId: "p1", output: null, error: "parse failure", retries: 3 },
  });

  expect((dataService.updatePartStage as any).mock.calls.length).toBe(1);
  expect((dataService.updatePartStage as any).mock.calls[0][3]).toBeNull();
  expect((dataService.updatePartStage as any).mock.calls[0][4]).toBe("parse failure");
});
