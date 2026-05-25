import type { IDataService, CreateQuoteInput, RetryQueueEntry, RetryQueueFilter } from "../../core/ports/IDataService";

export class MongoDataService implements IDataService {
  static async create(): Promise<MongoDataService> {
    return new MongoDataService();
  }

  async createQuote(input: CreateQuoteInput): Promise<any> {
    throw new Error("Not implemented");
  }

  async getQuote(quoteId: string): Promise<any | null> {
    throw new Error("Not implemented");
  }

  async submitForm(quoteId: string, formData: Record<string, unknown>, email: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async markPartFileUploaded(quoteId: string, partId: string, fileType: "2d" | "3d"): Promise<void> {
    throw new Error("Not implemented");
  }

  async updatePartStage(quoteId: string, partId: string, stage: string, output: Record<string, unknown> | null, error?: string, retries?: number): Promise<void> {
    throw new Error("Not implemented");
  }

  async updatePartPresignedUrls(quoteId: string, partId: string, presignedUrl2D: string, presignedUrl3D: string, expiry: Date): Promise<void> {
    throw new Error("Not implemented");
  }

  async updateQuoteStatus(quoteId: string, status: string, meta?: Record<string, unknown>): Promise<void> {
    throw new Error("Not implemented");
  }

  async markEmailSent(quoteId: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async cancelQuote(quoteId: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async findExpiredQuotes(expiryHours: number): Promise<any[]> {
    throw new Error("Not implemented");
  }

  async getQuoteStatus(quoteId: string): Promise<string | null> {
    throw new Error("Not implemented");
  }

  async isPartStageProcessed(quoteId: string, partId: string, stage: string): Promise<boolean> {
    throw new Error("Not implemented");
  }

  async addToRetryQueue(entry: RetryQueueEntry): Promise<void> {
    throw new Error("Not implemented");
  }

  async getRetryQueue(filter?: RetryQueueFilter): Promise<RetryQueueEntry[]> {
    throw new Error("Not implemented");
  }

  async markRetryStatus(quoteId: string, partId: string, status: string): Promise<void> {
    throw new Error("Not implemented");
  }
}

export default MongoDataService;
