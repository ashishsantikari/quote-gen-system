import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { quoteCompletion } from "../../workers/quoteCompletion";

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

test("quote_all_mandatory_data_receipt starts 25s timer after DB lookup", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const timeoutsCreated: { cb: () => void; ms: number }[] = [];

  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    timeoutsCreated.push({ cb, ms });
    return 999 as any;
  }) as typeof setTimeout;

  try {
    const eventBus = createMockEventBus();
    const dataService = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q1",
        parts: [{ partId: "p1", name: "engine" }],
      })),
    });
    quoteCompletion(dataService, eventBus);

    await eventBus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
    });

    expect(timeoutsCreated.length).toBe(1);
    expect(timeoutsCreated[0]!.ms).toBe(25000);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("quote_all_mandatory_data_receipt does NOT start timer if quote not found in DB", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const timeoutsCreated: { cb: () => void; ms: number }[] = [];

  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    timeoutsCreated.push({ cb, ms });
    return 999 as any;
  }) as typeof setTimeout;

  try {
    const eventBus = createMockEventBus();
    const dataService = createMockDataService({
      getQuote: mock(() => Promise.resolve(null)),
    });
    quoteCompletion(dataService, eventBus);

    await eventBus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
    });

    expect(timeoutsCreated.length).toBe(0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("all parts processed publishes quote_data_normalization_complete", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const cleared: string[] = [];

  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    return `timer-q1` as any;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: any) => {
    cleared.push(String(id));
  }) as typeof clearTimeout;

  try {
    const eventBus = createMockEventBus();
    const dataService = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q1",
        parts: [{ partId: "p1", name: "engine" }],
      })),
    });
    quoteCompletion(dataService, eventBus);

    await eventBus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
    });

    await eventBus.publish({
      type: EventType.part_processing_complete,
      payload: { quoteId: "q1", partId: "p1" },
    });

    const completeEvents = eventBus.getPublished().filter(
      (e: any) => e.type === EventType.quote_data_normalization_complete
    );
    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0].payload.completionStatus).toBe("COMPLETE");
    expect(cleared.length).toBe(1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("timer fires, publishes quote_data_normalization_timed_out", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<string, () => void>();

  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    const id = `timer-${timers.size}`;
    timers.set(id, cb);
    return id as any;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const eventBus = createMockEventBus();
    const dataService = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q1",
        parts: [
          { partId: "p1", name: "engine" },
          { partId: "p2", name: "transmission" },
        ],
        processing: {
          p1: { form: { processed: false, output: null, error: null, retries: 0 }, "2d": { processed: false, output: null, error: null, retries: 0 }, "3d": { processed: false, output: null, error: null, retries: 0 } },
          p2: { form: { processed: false, output: null, error: null, retries: 0 }, "2d": { processed: false, output: null, error: null, retries: 0 }, "3d": { processed: false, output: null, error: null, retries: 0 } },
        },
      })),
    });
    quoteCompletion(dataService, eventBus);

    await eventBus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q1", receivedAt: new Date().toISOString() },
    });

    expect(timers.size).toBe(1);

    const timerCallback = [...timers.values()][0]!;
    await timerCallback();

    const timeoutEvents = eventBus.getPublished().filter(
      (e: any) => e.type === EventType.quote_data_normalization_timed_out
    );
    expect(timeoutEvents.length).toBe(1);
    expect(timeoutEvents[0].payload.pendingParts.length).toBe(2);
    expect(timeoutEvents[0].payload.completedParts).toEqual([]);
    expect(timeoutEvents[0].payload.timeoutAt).toBeTruthy();
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("partial completion — timer fires with some parts done", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<string, () => void>();

  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    const id = `timer-${timers.size}`;
    timers.set(id, cb);
    return id as any;
  }) as typeof setTimeout;
  globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

  try {
    const eventBus = createMockEventBus();
    const dataService = createMockDataService({
      getQuote: mock(() => Promise.resolve({
        quoteId: "q2",
        parts: [
          { partId: "p1", name: "bumper" },
          { partId: "p2", name: "fender" },
        ],
        processing: {
          p1: { form: { processed: true, output: {}, error: null, retries: 0 }, "2d": { processed: true, output: {}, error: null, retries: 0 }, "3d": { processed: true, output: {}, error: null, retries: 0 } },
          p2: { form: { processed: false, output: null, error: null, retries: 0 }, "2d": { processed: false, output: null, error: null, retries: 0 }, "3d": { processed: false, output: null, error: null, retries: 0 } },
        },
      })),
    });
    quoteCompletion(dataService, eventBus);

    await eventBus.publish({
      type: EventType.quote_all_mandatory_data_receipt,
      payload: { quoteId: "q2", receivedAt: new Date().toISOString() },
    });

    // One part completes processing
    await eventBus.publish({
      type: EventType.part_processing_complete,
      payload: { quoteId: "q2", partId: "p1" },
    });

    const timerCallback = [...timers.values()][0]!;
    await timerCallback();

    const timeoutEvents = eventBus.getPublished().filter(
      (e: any) => e.type === EventType.quote_data_normalization_timed_out
    );
    expect(timeoutEvents.length).toBe(1);
    expect(timeoutEvents[0].payload.completedParts).toEqual(["p1"]);
    expect(timeoutEvents[0].payload.pendingParts.length).toBe(1);
    expect(timeoutEvents[0].payload.pendingParts[0].partId).toBe("p2");
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
