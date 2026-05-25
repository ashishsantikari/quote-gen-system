export interface CreateQuoteInput {
  quoteId: string;
  parts: { partId: string; name: string }[];
}

export interface RetryQueueEntry {
  quoteId: string;
  partId: string;
  stage: string;
  error: string;
  attempts: number;
  status: string;
}

export interface RetryQueueFilter {
  status?: string;
}

export interface IDataService {
  createQuote(input: CreateQuoteInput): Promise<any>;
  getQuote(quoteId: string): Promise<any | null>;
  submitForm(quoteId: string, formData: Record<string, unknown>, email: string): Promise<void>;
  markPartFileUploaded(quoteId: string, partId: string, fileType: "2d" | "3d"): Promise<void>;
  updatePartStage(quoteId: string, partId: string, stage: string, output: Record<string, unknown> | null, error?: string, retries?: number): Promise<void>;
  updatePartPresignedUrls(quoteId: string, partId: string, presignedUrl2D: string, presignedUrl3D: string, expiry: Date): Promise<void>;
  updateQuoteStatus(quoteId: string, status: string, meta?: Record<string, unknown>): Promise<void>;
  markEmailSent(quoteId: string): Promise<void>;
  cancelQuote(quoteId: string): Promise<void>;
  findExpiredQuotes(expiryHours: number): Promise<any[]>;
  getQuoteStatus(quoteId: string): Promise<string | null>;
  isPartStageProcessed(quoteId: string, partId: string, stage: string): Promise<boolean>;
  addToRetryQueue(entry: RetryQueueEntry): Promise<void>;
  getRetryQueue(filter?: RetryQueueFilter): Promise<RetryQueueEntry[]>;
  markRetryStatus(quoteId: string, partId: string, status: string): Promise<void>;
}
