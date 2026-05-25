import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { quoteGenerator } from "../../workers/quoteGenerator";

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

function makeQuote(overrides: any = {}) {
  return {
    quoteId: "q1",
    email: "test@example.com",
    parts: [
      {
        partId: "p1",
        name: "engine",
        formOutput: { processedForm: { color: "red" } },
        formError: null,
        formProcessed: true,
        file2DOutput: { processed: true },
        file2DError: null,
        file2DProcessed: true,
        file3DOutput: { processed: true },
        file3DError: null,
        file3DProcessed: true,
        ...overrides.part1,
      },
      {
        partId: "p2",
        name: "transmission",
        formOutput: { processedForm: { size: "large" } },
        formError: null,
        formProcessed: true,
        file2DOutput: { processed: true },
        file2DError: null,
        file2DProcessed: true,
        file3DOutput: { processed: true },
        file3DError: null,
        file3DProcessed: true,
        ...overrides.part2,
      },
    ],
    ...overrides,
  };
}

test("reads quote, builds transparency report, publishes QuoteGenerated", async () => {
  const quote = makeQuote();
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteInfoComplete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.QuoteGenerated
  );
  expect(generatedEvents.length).toBe(1);
  const payload = generatedEvents[0].payload;
  expect(payload.transparency.totalStages).toBe(6);
  expect(payload.transparency.successful).toBe(6);
  expect(payload.transparency.errored).toBe(0);
  expect(payload.transparency.timedOut).toBe(0);
  expect(payload.transparency.dataCompleteness).toBe("COMPLETE");
  expect(payload.generatedData.parts.length).toBe(2);
});

test("includes assumptions for errored stages", async () => {
  const quote = makeQuote({
    part1: { formError: "parse error", formOutput: null, formProcessed: false },
  });
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteInfoComplete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE_WITH_ERRORS" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.QuoteGenerated
  );
  const payload = generatedEvents[0].payload;
  expect(payload.transparency.errored).toBe(1);
  expect(payload.transparency.dataCompleteness).toBe("PARTIAL");
  expect(payload.transparency.assumptions.length).toBeGreaterThan(0);
  expect(payload.transparency.assumptions.some((a: string) => a.includes("engine"))).toBe(true);
  expect(payload.transparency.assumptions.some((a: string) => a.includes("form"))).toBe(true);
});

test("includes assumptions for timed-out stages", async () => {
  const quote = makeQuote({
    part2: { file2DOutput: null, file2DError: null, file2DProcessed: false },
  });
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteTimedOut,
    payload: {
      quoteId: "q1",
      completedParts: ["p1"],
      pendingParts: [{ partId: "p2", pendingStages: ["2d"] }],
      timeoutAt: new Date().toISOString(),
    },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.QuoteGenerated
  );
  const payload = generatedEvents[0].payload;
  expect(payload.transparency.timedOut).toBeGreaterThanOrEqual(1);
  expect(payload.transparency.dataCompleteness).toBe("COMPLETE_WITH_ESTIMATES");
  expect(payload.transparency.assumptions.some((a: string) => a.includes("time"))).toBe(true);
});

test("handles mixed errors and timeouts", async () => {
  const quote = makeQuote({
    part1: { formError: "bad data", formOutput: null, formProcessed: false },
    part2: { file3DOutput: null, file3DError: null, file3DProcessed: false },
  });
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteInfoComplete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE_WITH_ERRORS" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.QuoteGenerated
  );
  const payload = generatedEvents[0].payload;
  expect(payload.transparency.errored).toBe(1);
  expect(payload.transparency.timedOut).toBe(1);
  expect(payload.transparency.successful).toBe(4);
  expect(payload.transparency.dataCompleteness).toBe("PARTIAL");
});

test("returns early if quote is not found", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(null)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.QuoteInfoComplete,
    payload: { quoteId: "nonexistent", completionStatus: "COMPLETE" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.QuoteGenerated
  );
  expect(generatedEvents.length).toBe(0);
});
