import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { twoDProcessor } from "../../workers/twoDProcessor";

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

function createMockFileStorage(overrides?: Partial<IFileStorage>): IFileStorage {
  return {
    generatePresignedUrl: mock(() => Promise.resolve("https://s3.example.com/url")),
    deleteFiles: mock(() => Promise.resolve()),
    fileExists: mock(() => Promise.resolve(true)),
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

test("subscribes to QuoteRequestReceived and processes 2D files for all parts", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      parts: [{ partId: "p1", name: "engine", file2DKey: "quotes/q1/parts/p1/2d/model.stl" }],
    })),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  twoDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.quote_all_mandatory_data_receipt,
    payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
  });

  const published = eventBus.getPublished();
  const processedEvents = published.filter((e: any) => e.type === EventType.part_2d_complete);
  expect(processedEvents.length).toBe(1);
  expect(processedEvents[0].payload.output).toBeTruthy();
  expect(processedEvents[0].payload.output.fileKey).toBe("quotes/q1/parts/p1/2d/model.stl");
});

test("ignores QuoteRequestReceived from other sources (filtered by type)", async () => {
  const dataService = createMockDataService();
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  twoDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.quote_cancel,
    payload: { quoteId: "q1", reason: "EXPIRED" },
  });

  const published = eventBus.getPublished();
  const processedEvents = published.filter((e: any) => e.type === EventType.part_2d_complete);
  expect(processedEvents.length).toBe(0);
});

test("idempotency check skips already processed 2D parts", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      parts: [{ partId: "p1", name: "engine", file2DKey: "quotes/q1/parts/p1/2d/model.stl" }],
    })),
    isPartStageProcessed: mock(() => Promise.resolve(true)),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  twoDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.quote_all_mandatory_data_receipt,
    payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
  });

  const published = eventBus.getPublished();
  const successEvents = published.filter(
    (e: any) => e.type === EventType.part_2d_complete && e.payload.output !== null
  );
  expect(successEvents.length).toBe(0);
});

test("circuit breaker records failure on file not found", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      parts: [{ partId: "p1", name: "engine", file2DKey: "quotes/q1/parts/p1/2d/model.stl" }],
    })),
  });
  const fileStorage = createMockFileStorage({
    fileExists: mock(() => Promise.resolve(false)),
  });
  const eventBus = createMockEventBus();

  twoDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.quote_all_mandatory_data_receipt,
    payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
  });

  const published = eventBus.getPublished();
  const failEvents = published.filter(
    (e: any) => e.type === EventType.part_2d_complete && e.payload.error
  );
  const opFailEvents = published.filter((e: any) => e.type === EventType.error_operation_fail);
  expect(failEvents.length).toBeGreaterThanOrEqual(1);
  expect(opFailEvents.length).toBeGreaterThanOrEqual(1);
  expect(opFailEvents[0].payload.stage).toBe("2d");
});

test("on failure, publishes Part2DProcessed with error + OperationFailed", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      parts: [{ partId: "p1", name: "engine", file2DKey: "quotes/q1/parts/p1/2d/model.stl" }],
    })),
    isPartStageProcessed: mock(() => Promise.reject(new Error("DB connection lost"))),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  twoDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.quote_all_mandatory_data_receipt,
    payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
  });

  const published = eventBus.getPublished();
  const opFailEvents = published.filter((e: any) => e.type === EventType.error_operation_fail);
  expect(opFailEvents.length).toBeGreaterThanOrEqual(1);
});

test("skips parts without a file2DKey", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({
      quoteId: "q1",
      parts: [
        { partId: "p1", name: "engine", file2DKey: "quotes/q1/parts/p1/2d/engine.stl" },
        { partId: "p2", name: "transmission" },
      ],
    })),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  twoDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.quote_all_mandatory_data_receipt,
    payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
  });

  const published = eventBus.getPublished();
  const processedEvents = published.filter((e: any) => e.type === EventType.part_2d_complete);
  expect(processedEvents.length).toBe(1);
  expect(processedEvents[0].payload.partId).toBe("p1");
});
