import { test, expect, mock } from "bun:test";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEmailService } from "../../core/ports/IEmailService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { emailWorker } from "../../workers/emailWorker";

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

function createMockEmailService(overrides?: Partial<IEmailService>): IEmailService {
  return {
    sendQuoteEmail: mock(() => Promise.resolve()),
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

test("receives PdfGenerated, gets email from DB, sends email, publishes EmailSent", async () => {
  const quote = {
    quoteId: "q1",
    email: "user@example.com",
    transparency: {
      totalStages: 6,
      successful: 5,
      errored: 1,
      timedOut: 0,
      dataCompleteness: "PARTIAL",
      assumptions: ["Part engine form: parse error — best assumption used"],
    },
  };
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const emailService = createMockEmailService();
  const eventBus = createMockEventBus();

  emailWorker(dataService, emailService, eventBus);

  await eventBus.publish({
    type: EventType.PdfGenerated,
    payload: { quoteId: "q1", pdfKey: "quotes/q1/output/quote.pdf", pdfUrl: "https://s3.example.com/url" },
  });

  const published = eventBus.getPublished();
  const emailEvents = published.filter((e: any) => e.type === EventType.EmailSent);
  expect(emailEvents.length).toBe(1);
  expect(emailEvents[0].payload.quoteId).toBe("q1");
  expect(emailEvents[0].payload.sentAt).toBeTruthy();
});

test("includes transparency report in email body", async () => {
  const quote = {
    quoteId: "q1",
    email: "user@example.com",
    transparency: {
      totalStages: 3,
      successful: 3,
      errored: 0,
      timedOut: 0,
      dataCompleteness: "COMPLETE",
      assumptions: [],
    },
  };
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const emailService = createMockEmailService();
  const eventBus = createMockEventBus();

  emailWorker(dataService, emailService, eventBus);

  await eventBus.publish({
    type: EventType.PdfGenerated,
    payload: { quoteId: "q1", pdfKey: "quotes/q1/output/quote.pdf", pdfUrl: "https://s3.example.com/url" },
  });

  const published = eventBus.getPublished();
  const emailEvents = published.filter((e: any) => e.type === EventType.EmailSent);
  expect(emailEvents.length).toBe(1);
});

test("returns early if quote not found", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(null)),
  });
  const emailService = createMockEmailService();
  const eventBus = createMockEventBus();

  emailWorker(dataService, emailService, eventBus);

  await eventBus.publish({
    type: EventType.PdfGenerated,
    payload: { quoteId: "nonexistent", pdfKey: "key", pdfUrl: "url" },
  });

  const published = eventBus.getPublished();
  const emailEvents = published.filter((e: any) => e.type === EventType.EmailSent);
  expect(emailEvents.length).toBe(0);
});

test("returns early if quote has no email", async () => {
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve({ quoteId: "q1", email: null })),
  });
  const emailService = createMockEmailService();
  const eventBus = createMockEventBus();

  emailWorker(dataService, emailService, eventBus);

  await eventBus.publish({
    type: EventType.PdfGenerated,
    payload: { quoteId: "q1", pdfKey: "key", pdfUrl: "url" },
  });

  const published = eventBus.getPublished();
  const emailEvents = published.filter((e: any) => e.type === EventType.EmailSent);
  expect(emailEvents.length).toBe(0);
});

test("includes PDF attachment in email", async () => {
  const quote = {
    quoteId: "q1",
    email: "user@example.com",
    transparency: null,
  };
  const dataService = createMockDataService({
    getQuote: mock(() => Promise.resolve(quote)),
  });
  const emailService = createMockEmailService();
  const eventBus = createMockEventBus();

  emailWorker(dataService, emailService, eventBus);

  await eventBus.publish({
    type: EventType.PdfGenerated,
    payload: { quoteId: "q1", pdfKey: "quotes/q1/output/quote.pdf", pdfUrl: "https://s3.example.com/url" },
  });

  const published = eventBus.getPublished();
  const emailEvents = published.filter((e: any) => e.type === EventType.EmailSent);
  expect(emailEvents.length).toBe(1);
});
