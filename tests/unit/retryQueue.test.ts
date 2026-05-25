import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { retryQueue } from "../../workers/retryQueue";

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

test("receives RetryCommand, re-publishes FormUploaded if form was submitted", async () => {
  const quote = {
    quoteId: "q1",
    formSubmitted: true,
    formData: { color: "red" },
    email: "test@example.com",
    parts: [],
  };
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  retryQueue(dataService, eventBus);

  await eventBus.publish({
    type: EventType.RetryCommand,
    payload: { quoteId: "q1" },
  });

  const published = eventBus.getPublished();
  const formEvents = published.filter((e: any) => e.type === EventType.FormUploaded);
  expect(formEvents.length).toBe(1);
  expect(formEvents[0].payload.quoteId).toBe("q1");
  expect(formEvents[0].payload.email).toBe("test@example.com");
});

test("re-publishes FileUploaded for parts with 2D and 3D keys", async () => {
  const quote = {
    quoteId: "q1",
    formSubmitted: false,
    parts: [
      { partId: "p1", file2DKey: "key-2d-1", file3DKey: "key-3d-1" },
      { partId: "p2", file2DKey: null, file3DKey: "key-3d-2" },
    ],
  };
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  retryQueue(dataService, eventBus);

  await eventBus.publish({
    type: EventType.RetryCommand,
    payload: { quoteId: "q1" },
  });

  const published = eventBus.getPublished();
  const fileEvents = published.filter((e: any) => e.type === EventType.FileUploaded);
  expect(fileEvents.length).toBe(3);

  const p1_2d = fileEvents.find((e: any) => e.payload.partId === "p1" && e.payload.fileType === "2d");
  expect(p1_2d).toBeTruthy();
  const p1_3d = fileEvents.find((e: any) => e.payload.partId === "p1" && e.payload.fileType === "3d");
  expect(p1_3d).toBeTruthy();
  const p2_3d = fileEvents.find((e: any) => e.payload.partId === "p2" && e.payload.fileType === "3d");
  expect(p2_3d).toBeTruthy();
});

test("calls markRetryStatus for each part", async () => {
  const quote = {
    quoteId: "q1",
    formSubmitted: false,
    parts: [
      { partId: "p1", file2DKey: "key-2d", file3DKey: null },
      { partId: "p2", file2DKey: null, file3DKey: null },
    ],
  };
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  retryQueue(dataService, eventBus);

  await eventBus.publish({
    type: EventType.RetryCommand,
    payload: { quoteId: "q1" },
  });

  expect((dataService.markRetryStatus as any).mock.calls.length).toBe(2);
});

test("returns early if quote not found", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(null)),
  });
  const eventBus = createMockEventBus();

  retryQueue(dataService, eventBus);

  await eventBus.publish({
    type: EventType.RetryCommand,
    payload: { quoteId: "nonexistent" },
  });

  const published = eventBus.getPublished();
  const retryEvents = published.filter(
    (e: any) => e.type === EventType.FormUploaded || e.type === EventType.FileUploaded
  );
  expect(retryEvents.length).toBe(0);
});
