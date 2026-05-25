import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { formProcessor } from "../../workers/formProcessor";

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

test("subscribes to FormUploaded event on registration", () => {
  const dataService = createMockDataService();
  const eventBus = createMockEventBus();

  formProcessor(dataService, eventBus);

  const formPublished = eventBus.getPublished();
  expect(formPublished.length).toBe(0);
});

test("processes parts and publishes PartFormProcessed for each part", async () => {
  const quoteId = "q1";
  const parts = [
    { partId: "p1", name: "engine" },
    { partId: "p2", name: "transmission" },
  ];
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({ quoteId, parts, email: null })),
  });
  const eventBus = createMockEventBus();

  formProcessor(dataService, eventBus);

  await eventBus.publish({
    type: EventType.FormUploaded,
    payload: { quoteId, formData: { p1: { color: "red" }, p2: { size: "large" } }, email: "test@example.com" },
  });

  const published = eventBus.getPublished();
  const formEvents = published.filter((e: any) => e.type === EventType.PartFormProcessed);
  expect(formEvents.length).toBe(2);
  expect(formEvents[0].payload.partId).toBe("p1");
  expect(formEvents[0].payload.output).toBeTruthy();
  expect(formEvents[1].payload.partId).toBe("p2");
  expect(formEvents[1].payload.output).toBeTruthy();
});

test("skips already processed parts via idempotency check", async () => {
  const quoteId = "q1";
  const parts = [{ partId: "p1", name: "engine" }];
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({ quoteId, parts, email: null })),
    isPartStageProcessed: mock(() => Promise.resolve(true)),
  });
  const eventBus = createMockEventBus();

  formProcessor(dataService, eventBus);

  await eventBus.publish({
    type: EventType.FormUploaded,
    payload: { quoteId, formData: { color: "red" }, email: "test@example.com" },
  });

  const published = eventBus.getPublished();
  const successEvents = published.filter(
    (e: any) => e.type === EventType.PartFormProcessed && e.payload.output !== null
  );
  expect(successEvents.length).toBe(0);
});

test("on failure, publishes PartFormProcessed with error and OperationFailed", async () => {
  const quoteId = "q1";
  const parts = [{ partId: "p1", name: "engine" }];
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({ quoteId, parts, email: null })),
    isPartStageProcessed: mock(() => Promise.reject(new Error("DB error"))),
  });
  const eventBus = createMockEventBus();

  formProcessor(dataService, eventBus);

  await eventBus.publish({
    type: EventType.FormUploaded,
    payload: { quoteId, formData: { color: "red" }, email: "test@example.com" },
  });

  const published = eventBus.getPublished();
  const failEvents = published.filter(
    (e: any) => e.type === EventType.PartFormProcessed && e.payload.error
  );
  const opFailEvents = published.filter((e: any) => e.type === EventType.OperationFailed);
  expect(failEvents.length).toBeGreaterThanOrEqual(1);
  expect(opFailEvents.length).toBeGreaterThanOrEqual(1);
  expect(opFailEvents[0].payload.stage).toBe("form");
});

test("no-op if quote is not found", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(null)),
  });
  const eventBus = createMockEventBus();

  formProcessor(dataService, eventBus);

  await eventBus.publish({
    type: EventType.FormUploaded,
    payload: { quoteId: "nonexistent", formData: {}, email: "test@example.com" },
  });

  const published = eventBus.getPublished();
  const formEvents = published.filter((e: any) => e.type === EventType.PartFormProcessed);
  expect(formEvents.length).toBe(0);
});
