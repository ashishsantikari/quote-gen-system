import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import Hapi from "@hapi/hapi";
import type { IDataService, CreateQuoteInput, RetryQueueEntry, RetryQueueFilter } from "../../core/ports/IDataService";
import type { IFileStorage } from "../../core/ports/IFileStorage";
import type { IEmailService } from "../../core/ports/IEmailService";
import type { INotificationService } from "../../core/ports/INotificationService";
import { InMemoryEventBus } from "../../adapters/eventbus/InMemoryEventBus";
import QuotePlugin from "../../plugins/quote";
import { formProcessor } from "../../workers/formProcessor";
import { twoDProcessor } from "../../workers/twoDProcessor";
import { threeDProcessor } from "../../workers/threeDProcessor";
import { partCompletion } from "../../workers/partCompletion";
import { quoteCompletion } from "../../workers/quoteCompletion";
import { quoteGenerator } from "../../workers/quoteGenerator";
import { notificationService } from "../../workers/notificationService";
import { pdfGenerator } from "../../workers/pdfGenerator";
import { emailWorker } from "../../workers/emailWorker";
import { mongoPersister } from "../../workers/mongoPersister";

class InMemoryDataService implements IDataService {
  private quotes = new Map<string, any>();
  private retryEntries: RetryQueueEntry[] = [];

  async createQuote(input: CreateQuoteInput): Promise<any> {
    const q = {
      quoteId: input.quoteId,
      parts: input.parts.map((p) => ({
        partId: p.partId,
        name: p.name,
        formProcessed: false,
        file2DProcessed: false,
        file3DProcessed: false,
        formOutput: null as any,
        file2DOutput: null as any,
        file3DOutput: null as any,
        formError: null as string | null,
        file2DError: null as string | null,
        file3DError: null as string | null,
        file2DKey: null as string | null,
        file3DKey: null as string | null,
        presignedUrl2D: null as string | null,
        presignedUrl3D: null as string | null,
      })),
      email: null as string | null,
      formSubmitted: false,
      formData: null as Record<string, unknown> | null,
      status: "QUOTE_INIT",
      emailSent: false,
    };
    this.quotes.set(input.quoteId, q);
    return q;
  }

  async getQuote(quoteId: string): Promise<any | null> {
    return this.quotes.get(quoteId) || null;
  }

  async submitForm(quoteId: string, formData: Record<string, unknown>, email: string): Promise<void> {
    const q = this.quotes.get(quoteId);
    if (q) { q.formData = formData; q.email = email; q.formSubmitted = true; }
  }

  async markPartFileUploaded(quoteId: string, partId: string, fileType: "2d" | "3d"): Promise<void> {
    const q = this.quotes.get(quoteId);
    if (!q) return;
    const part = q.parts.find((p: any) => p.partId === partId);
    if (!part) return;
    const key = `quotes/${quoteId}/parts/${partId}/${fileType}/${part.name}`;
    if (fileType === "2d") part.file2DKey = key;
    if (fileType === "3d") part.file3DKey = key;
  }

  async updatePartStage(
    quoteId: string, partId: string, stage: string,
    output: Record<string, unknown> | null, error?: string, retries?: number
  ): Promise<void> {
    const q = this.quotes.get(quoteId);
    if (!q) return;
    const part = q.parts.find((p: any) => p.partId === partId);
    if (!part) return;
    if (stage === "form") { part.formProcessed = true; part.formOutput = output; part.formError = error || null; }
    else if (stage === "2d") { part.file2DProcessed = true; part.file2DOutput = output; part.file2DError = error || null; }
    else if (stage === "3d") { part.file3DProcessed = true; part.file3DOutput = output; part.file3DError = error || null; }
  }

  async updatePartPresignedUrls(
    quoteId: string, partId: string, presignedUrl2D: string, presignedUrl3D: string, expiry: Date
  ): Promise<void> {
    const q = this.quotes.get(quoteId);
    if (!q) return;
    const part = q.parts.find((p: any) => p.partId === partId);
    if (!part) return;
    part.presignedUrl2D = presignedUrl2D;
    part.presignedUrl3D = presignedUrl3D;
  }

  async updateQuoteStatus(quoteId: string, status: string, meta?: Record<string, unknown>): Promise<void> {
    const q = this.quotes.get(quoteId);
    if (q) { q.status = status; if (meta) Object.assign(q, meta); }
  }

  async markEmailSent(quoteId: string): Promise<void> {
    const q = this.quotes.get(quoteId);
    if (q) q.emailSent = true;
  }

  async cancelQuote(quoteId: string): Promise<void> {
    const q = this.quotes.get(quoteId);
    if (q) q.status = "CANCELLED";
  }

  async findExpiredQuotes(expiryHours: number): Promise<any[]> { return []; }

  async getQuoteStatus(quoteId: string): Promise<string | null> {
    const q = this.quotes.get(quoteId);
    return q ? q.status : null;
  }

  async isPartStageProcessed(quoteId: string, partId: string, stage: string): Promise<boolean> {
    const q = this.quotes.get(quoteId);
    if (!q) return false;
    const part = q.parts.find((p: any) => p.partId === partId);
    if (!part) return false;
    if (stage === "form") return part.formProcessed;
    if (stage === "2d") return part.file2DProcessed;
    if (stage === "3d") return part.file3DProcessed;
    return false;
  }

  async addToRetryQueue(entry: RetryQueueEntry): Promise<void> { this.retryEntries.push(entry); }

  async getRetryQueue(filter?: RetryQueueFilter): Promise<RetryQueueEntry[]> { return this.retryEntries; }

  async markRetryStatus(quoteId: string, partId: string, status: string): Promise<void> {}

  getInternalQuotes() { return this.quotes; }
}

describe("Full Integration Flow", () => {
  let server: Hapi.Server;
  let dataService: InMemoryDataService;
  let baseUrl: string;

  beforeAll(async () => {
    dataService = new InMemoryDataService();

    const fileStorage: IFileStorage = {
      generatePresignedUrl: async () => "https://s3.example.com/presigned-url",
      deleteFiles: async () => {},
      fileExists: async () => true,
    };
    const emailService: IEmailService = {
      sendQuoteEmail: async () => {},
    };
    const notifyService: INotificationService = {
      notify: async () => {},
    };
    const eventBus = new InMemoryEventBus();

    formProcessor(dataService, eventBus);
    twoDProcessor(dataService, fileStorage, eventBus);
    threeDProcessor(dataService, fileStorage, eventBus);
    partCompletion(eventBus);
    quoteCompletion(eventBus);
    quoteGenerator(dataService, eventBus);
    notificationService(notifyService, eventBus);
    pdfGenerator(fileStorage, eventBus);
    emailWorker(dataService, emailService, eventBus);
    mongoPersister(dataService, eventBus);

    server = Hapi.server({ port: 0, host: "localhost" });

    await server.register([
      { plugin: QuotePlugin, options: { dataService, fileStorage, eventBus } },
    ]);

    await server.start();
    baseUrl = server.info.uri;
  });

  afterAll(async () => {
    await server.stop({ timeout: 1000 });
  });

  async function postJson(url: string, body: any) {
    const res = await fetch(`${baseUrl}${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.text();
    return { statusCode: res.status, payload };
  }

  async function getJson(url: string) {
    const res = await fetch(`${baseUrl}${url}`);
    const payload = await res.text();
    return { statusCode: res.status, payload };
  }

  test("full flow: create -> confirm 2D/3D -> form -> quote completed", async () => {
    const createRes = await postJson("/quote/create", {
      parts: [{ name: "engine" }, { name: "transmission" }],
    });

    expect(createRes.statusCode).toBe(201);
    const createBody = JSON.parse(createRes.payload);
    expect(createBody.quoteId).toBeTruthy();
    expect(createBody.parts.length).toBe(2);

    const quoteId: string = createBody.quoteId;
    const part1 = createBody.parts[0];
    const part2 = createBody.parts[1];

    expect(part1.presignedUrl2D).toBeTruthy();
    expect(part1.presignedUrl3D).toBeTruthy();

    const quote = await dataService.getQuote(quoteId);
    expect(quote).toBeTruthy();
    expect(quote.parts.length).toBe(2);

    const r1 = await postJson(`/quote/${quoteId}/part/${part1.partId}/confirm`, { type: "2d" });
    expect(r1.statusCode).toBe(200);

    const r2 = await postJson(`/quote/${quoteId}/part/${part2.partId}/confirm`, { type: "2d" });
    expect(r2.statusCode).toBe(200);

    const r3 = await postJson(`/quote/${quoteId}/part/${part1.partId}/confirm`, { type: "3d" });
    expect(r3.statusCode).toBe(200);

    const r4 = await postJson(`/quote/${quoteId}/part/${part2.partId}/confirm`, { type: "3d" });
    expect(r4.statusCode).toBe(200);

    const formRes = await postJson(`/quote/${quoteId}/form`, {
      formData: { p1: { color: "red" }, p2: { size: "large" } },
      email: "customer@example.com",
    });
    expect(formRes.statusCode).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const finalQuote = await dataService.getQuote(quoteId);
    expect(finalQuote).toBeTruthy();
    expect(finalQuote.email).toBe("customer@example.com");
    expect(finalQuote.formSubmitted).toBe(true);

    for (const part of finalQuote.parts) {
      expect(part.formProcessed).toBe(true);
      expect(part.file2DProcessed).toBe(true);
      expect(part.file3DProcessed).toBe(true);
      expect(part.formOutput).toBeTruthy();
      expect(part.file2DOutput).toBeTruthy();
      expect(part.file3DOutput).toBeTruthy();
    }

    expect(finalQuote.emailSent).toBe(true);

    const getRes = await getJson(`/quote/${quoteId}`);
    expect(getRes.statusCode).toBe(200);
    const getBody = JSON.parse(getRes.payload);
    expect(getBody.quoteId).toBe(quoteId);
  });

  test("verifies quote not found returns 404", async () => {
    const res = await getJson("/quote/00000000-0000-0000-0000-000000000000");
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe("Quote not found");
  });

  test("verifies create with no parts returns 400", async () => {
    const res = await postJson("/quote/create", { parts: [] });
    expect(res.statusCode).toBe(400);
  });

  test("verifies form with invalid email returns 400", async () => {
    const res = await postJson("/quote/some-id/form", {
      formData: {},
      email: "not-an-email",
    });
    expect(res.statusCode).toBe(400);
  });

  test("verifies confirm with invalid type returns 400", async () => {
    const res = await postJson("/quote/some-id/part/some-part/confirm", {
      type: "invalid",
    });
    expect(res.statusCode).toBe(400);
  });

  test("regenerate presigned URL returns new URL", async () => {
    const createRes = await postJson("/quote/create", {
      parts: [{ name: "bumper" }],
    });
    const { quoteId, parts } = JSON.parse(createRes.payload);
    const partId = parts[0].partId;

    const regenRes = await postJson(`/quote/${quoteId}/regenerate-url`, {
      partId,
      type: "2d",
    });

    expect(regenRes.statusCode).toBe(200);
    const regenBody = JSON.parse(regenRes.payload);
    expect(regenBody.presignedUrl).toBeTruthy();
    expect(regenBody.type).toBe("2d");
  });
});
