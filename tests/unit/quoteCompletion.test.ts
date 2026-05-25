import { test, expect } from "bun:test";
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

test("on QuoteCreated, starts timer", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const timeoutsCreated: number[] = [];

  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    timeoutsCreated.push(ms);
    return 999 as any;
  }) as typeof setTimeout;

  try {
    const eventBus = createMockEventBus();
    quoteCompletion(eventBus);

    eventBus.publish({
      type: EventType.QuoteCreated,
      payload: { quoteId: "q1", parts: [{ partId: "p1", name: "engine" }] },
    });

    expect(timeoutsCreated.length).toBe(1);
    expect(timeoutsCreated[0]).toBe(25000);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

test("all parts processed publishes QuoteInfoComplete with COMPLETE", async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const timers = new Map<string, () => void>();
  const cleared: string[] = [];

  globalThis.setTimeout = ((cb: () => void, ms: number) => {
    const id = `timer-${timers.size}`;
    timers.set(id, cb);
    return id as any;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((id: any) => {
    cleared.push(String(id));
  }) as typeof clearTimeout;

  try {
    const eventBus = createMockEventBus();
    quoteCompletion(eventBus);

    const quoteId = "q1";
    const parts = [{ partId: "p1", name: "engine" }];

    await eventBus.publish({
      type: EventType.QuoteCreated,
      payload: { quoteId, parts },
    });

    await eventBus.publish({
      type: EventType.PartFormProcessed,
      payload: { quoteId, partId: "p1", output: {} },
    });
    await eventBus.publish({
      type: EventType.Part2DProcessed,
      payload: { quoteId, partId: "p1", output: {} },
    });
    await eventBus.publish({
      type: EventType.Part3DProcessed,
      payload: { quoteId, partId: "p1", output: {} },
    });
    await eventBus.publish({
      type: EventType.PartProcessingComplete,
      payload: { quoteId, partId: "p1" },
    });

    const completeEvents = eventBus.getPublished().filter(
      (e: any) => e.type === EventType.QuoteInfoComplete
    );
    expect(completeEvents.length).toBe(1);
    expect(completeEvents[0].payload.completionStatus).toBe("COMPLETE");
    expect(cleared.length).toBe(1);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});

test("timer fires publishes QuoteTimedOut with pending parts", async () => {
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
    quoteCompletion(eventBus);

    const quoteId = "q1";
    const parts = [
      { partId: "p1", name: "engine" },
      { partId: "p2", name: "transmission" },
    ];

    await eventBus.publish({
      type: EventType.QuoteCreated,
      payload: { quoteId, parts },
    });

    const timerCallback = [...timers.values()][0]!;
    await timerCallback();

    const timeoutEvents = eventBus.getPublished().filter(
      (e: any) => e.type === EventType.QuoteTimedOut
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

test("partial completion timer fires with some parts done", async () => {
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
    quoteCompletion(eventBus);

    const quoteId = "q2";
    const parts = [
      { partId: "p1", name: "bumper" },
      { partId: "p2", name: "fender" },
    ];

    await eventBus.publish({
      type: EventType.QuoteCreated,
      payload: { quoteId, parts },
    });
    await eventBus.publish({
      type: EventType.PartProcessingComplete,
      payload: { quoteId, partId: "p1" },
    });

    const timerCallback = [...timers.values()][0]!;
    await timerCallback();

    const timeoutEvents = eventBus.getPublished().filter(
      (e: any) => e.type === EventType.QuoteTimedOut
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
