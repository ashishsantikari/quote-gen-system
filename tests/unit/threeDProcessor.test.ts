import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { threeDProcessor } from "../../workers/threeDProcessor";

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

test("subscribes to FileUploaded and processes 3D files", async () => {
  const dataService = createMockDataService();
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  threeDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.FileUploaded,
    payload: { quoteId: "q1", partId: "p1", fileType: "3d", fileKey: "quotes/q1/parts/p1/3d/model.stl" },
  });

  const published = eventBus.getPublished();
  const processedEvents = published.filter((e: any) => e.type === EventType.Part3DProcessed);
  expect(processedEvents.length).toBe(1);
  expect(processedEvents[0].payload.output).toBeTruthy();
  expect(processedEvents[0].payload.output.fileKey).toBe("quotes/q1/parts/p1/3d/model.stl");
});

test("ignores FileUploaded events that are not 3D", async () => {
  const dataService = createMockDataService();
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  threeDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.FileUploaded,
    payload: { quoteId: "q1", partId: "p1", fileType: "2d", fileKey: "quotes/q1/parts/p1/2d/model.stl" },
  });

  const published = eventBus.getPublished();
  const processedEvents = published.filter((e: any) => e.type === EventType.Part3DProcessed);
  expect(processedEvents.length).toBe(0);
});

test("idempotency check skips already processed 3D parts", async () => {
  const dataService = createMockDataService({
    isPartStageProcessed: mock(() => Promise.resolve(true)),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  threeDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.FileUploaded,
    payload: { quoteId: "q1", partId: "p1", fileType: "3d", fileKey: "quotes/q1/parts/p1/3d/model.stl" },
  });

  const published = eventBus.getPublished();
  const successEvents = published.filter(
    (e: any) => e.type === EventType.Part3DProcessed && e.payload.output !== null
  );
  expect(successEvents.length).toBe(0);
});

test("circuit breaker records failure on file not found", async () => {
  const dataService = createMockDataService();
  const fileStorage = createMockFileStorage({
    fileExists: mock(() => Promise.resolve(false)),
  });
  const eventBus = createMockEventBus();

  threeDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.FileUploaded,
    payload: { quoteId: "q1", partId: "p1", fileType: "3d", fileKey: "quotes/q1/parts/p1/3d/model.stl" },
  });

  const published = eventBus.getPublished();
  const failEvents = published.filter(
    (e: any) => e.type === EventType.Part3DProcessed && e.payload.error
  );
  const opFailEvents = published.filter((e: any) => e.type === EventType.OperationFailed);
  expect(failEvents.length).toBeGreaterThanOrEqual(1);
  expect(opFailEvents.length).toBeGreaterThanOrEqual(1);
  expect(opFailEvents[0].payload.stage).toBe("3d");
});

test("on failure, publishes Part3DProcessed with error + OperationFailed", async () => {
  const dataService = createMockDataService({
    isPartStageProcessed: mock(() => Promise.reject(new Error("DB connection lost"))),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  threeDProcessor(dataService, fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.FileUploaded,
    payload: { quoteId: "q1", partId: "p1", fileType: "3d", fileKey: "quotes/q1/parts/p1/3d/model.stl" },
  });

  const published = eventBus.getPublished();
  const opFailEvents = published.filter((e: any) => e.type === EventType.OperationFailed);
  expect(opFailEvents.length).toBeGreaterThanOrEqual(1);
});
