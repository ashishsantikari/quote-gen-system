import { test, expect, mock } from "bun:test";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { pdfGenerator } from "../../workers/pdfGenerator";

function createMockFileStorage(overrides?: Partial<IFileStorage>): IFileStorage {
  return {
    generatePresignedUrl: mock(() => Promise.resolve("https://s3.example.com/quotes/q1/output/quote.pdf")),
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

test("receives QuoteGenerated, saves PDF, publishes PdfGenerated", async () => {
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  pdfGenerator(fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.QuoteGenerated,
    payload: {
      quoteId: "q1",
      generatedData: { quoteId: "q1" },
      transparency: {
        totalStages: 3,
        successful: 3,
        errored: 0,
        timedOut: 0,
        dataCompleteness: "COMPLETE",
        assumptions: [],
      },
    },
  });

  const published = eventBus.getPublished();
  const pdfEvents = published.filter((e: any) => e.type === EventType.PdfGenerated);
  expect(pdfEvents.length).toBe(1);
  expect(pdfEvents[0].payload.quoteId).toBe("q1");
  expect(pdfEvents[0].payload.pdfKey).toBe("quotes/q1/output/quote.pdf");
  expect(pdfEvents[0].payload.pdfUrl).toBeTruthy();
});

test("generates correct pdfKey path", async () => {
  const fileStorage = createMockFileStorage();
  const eventBus = createMockEventBus();

  pdfGenerator(fileStorage, eventBus);

  await eventBus.publish({
    type: EventType.QuoteGenerated,
    payload: {
      quoteId: "abc-123",
      generatedData: { quoteId: "abc-123" },
      transparency: {
        totalStages: 3,
        successful: 3,
        errored: 0,
        timedOut: 0,
        dataCompleteness: "COMPLETE",
        assumptions: [],
      },
    },
  });

  const published = eventBus.getPublished();
  const pdfEvents = published.filter((e: any) => e.type === EventType.PdfGenerated);
  expect(pdfEvents[0].payload.pdfKey).toBe("quotes/abc-123/output/quote.pdf");
});
