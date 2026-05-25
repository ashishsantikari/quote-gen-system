import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { cleanupWorker } from "../../workers/cleanupWorker";

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

test("finds expired quotes, deletes S3 files, publishes QuoteCancelled", async () => {
  const expiredQuotes = [
    {
      quoteId: "q1",
      parts: [
        { file2DKey: "quotes/q1/parts/p1/2d/model.stl", file3DKey: "quotes/q1/parts/p1/3d/model.stl" },
      ],
    },
    {
      quoteId: "q2",
      parts: [
        { file2DKey: "quotes/q2/parts/p1/2d/model.stl" },
        { file3DKey: "quotes/q2/parts/p2/3d/model.stl" },
      ],
    },
  ];

  const published: any[] = [];

  const dataService = createMockDataService({
    findExpiredQuotes: mock(() => Promise.resolve(expiredQuotes)),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((cb: () => void, ms: number) => {
    return 123 as any;
  }) as typeof setInterval;

  try {
    cleanupWorker(dataService, fileStorage, eventBus, 24);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const pub = eventBus.getPublished();
    const cancelEvents = pub.filter((e: any) => e.type === EventType.quote_cancel);
    expect(cancelEvents.length).toBe(2);
    expect(cancelEvents[0].payload.quoteId).toBe("q1");
    expect(cancelEvents[0].payload.reason).toBe("EXPIRED");
    expect(cancelEvents[1].payload.quoteId).toBe("q2");

    expect((fileStorage.deleteFiles as any).mock.calls.length).toBe(2);
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});

test("no expired quotes — no-op", async () => {
  const dataService = createMockDataService({
    findExpiredQuotes: mock(() => Promise.resolve([])),
  });
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  const originalSetInterval = globalThis.setInterval;
  globalThis.setInterval = ((cb: () => void, ms: number) => {
    return 123 as any;
  }) as typeof setInterval;

  try {
    cleanupWorker(dataService, fileStorage, eventBus, 24);

    await new Promise((resolve) => setTimeout(resolve, 50));

    const pub = eventBus.getPublished();
    const cancelEvents = pub.filter((e: any) => e.type === EventType.quote_cancel);
    expect(cancelEvents.length).toBe(0);
    expect((fileStorage.deleteFiles as any).mock.calls.length).toBe(0);
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});
