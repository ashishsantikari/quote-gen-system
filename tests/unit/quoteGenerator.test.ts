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

function makeQuote(overrides: any = {}) {
  const part1Proc = {
    form: { processed: true, output: { processedForm: { color: "red" } }, error: null, retries: 0 },
    "2d": { processed: true, output: { processed: true }, error: null, retries: 0 },
    "3d": { processed: true, output: { processed: true }, error: null, retries: 0 },
    ...overrides.part1,
  };
  const part2Proc = {
    form: { processed: true, output: { processedForm: { size: "large" } }, error: null, retries: 0 },
    "2d": { processed: true, output: { processed: true }, error: null, retries: 0 },
    "3d": { processed: true, output: { processed: true }, error: null, retries: 0 },
    ...overrides.part2,
  };

  return {
    quoteId: "q1",
    email: "test@example.com",
    parts: [
      { partId: "p1", name: "engine" },
      { partId: "p2", name: "transmission" },
    ],
    processing: { p1: part1Proc, p2: part2Proc },
    ...overrides,
  };
}

test("reads quote, builds transparency report, publishes quote_ready", async () => {
  const quote = makeQuote();
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.quote_data_normalization_complete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.quote_ready
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
    part1: { form: { processed: false, output: null, error: "parse error", retries: 0 } },
  });
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.quote_data_normalization_complete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE_WITH_ERRORS" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.quote_ready
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
    part2: { "2d": { processed: false, output: null, error: null, retries: 0 } },
  });
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.quote_data_normalization_timed_out,
    payload: {
      quoteId: "q1",
      completedParts: ["p1"],
      pendingParts: [{ partId: "p2", pendingStages: ["2d"] }],
      timeoutAt: new Date().toISOString(),
    },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.quote_ready
  );
  const payload = generatedEvents[0].payload;
  expect(payload.transparency.timedOut).toBeGreaterThanOrEqual(1);
  expect(payload.transparency.dataCompleteness).toBe("COMPLETE_WITH_ESTIMATES");
  expect(payload.transparency.assumptions.some((a: string) => a.includes("time"))).toBe(true);
});

test("handles mixed errors and timeouts", async () => {
  const quote = makeQuote({
    part1: { form: { processed: false, output: null, error: "bad data", retries: 0 } },
    part2: { "3d": { processed: false, output: null, error: null, retries: 0 } },
  });
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const eventBus = createMockEventBus();

  quoteGenerator(dataService, eventBus);

  await eventBus.publish({
    type: EventType.quote_data_normalization_complete,
    payload: { quoteId: "q1", completionStatus: "COMPLETE_WITH_ERRORS" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.quote_ready
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
    type: EventType.quote_data_normalization_complete,
    payload: { quoteId: "nonexistent", completionStatus: "COMPLETE" },
  });

  const generatedEvents = eventBus.getPublished().filter(
    (e: any) => e.type === EventType.quote_ready
  );
  expect(generatedEvents.length).toBe(0);
});
