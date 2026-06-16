import mongoose from "mongoose";
import type {
  IDataService,
  CreateQuoteInput,
  RetryQueueEntry,
  RetryQueueFilter,
} from "../../core/ports/IDataService";
import { DatabaseError } from "../../core/errors";
import { QuoteModel, RetryQueueModel } from "../../core/models/Quote";
import { buildPartKey } from "../../core/ids";
import { Logger } from "../../core/telemetry/logger";

const log = new Logger({ component: "MongoDataService" });

export class MongoDataService implements IDataService {
  static async create(): Promise<MongoDataService> {
    const uri = process.env.MONGODB_URI;
    if (!uri)
      throw new DatabaseError("connect", new Error("MONGODB_URI not set"));

    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(uri);
      const masked = uri.replace(/\/\/.*@/, "//***@");
      log.info("connected", { uri: masked });
    }

    return new MongoDataService();
  }

  async createQuote(input: CreateQuoteInput): Promise<any> {
    const processing: Record<string, any> = {};
    for (const p of input.parts) {
      processing[p.partId] = {
        form: { processed: false, output: null, error: null, retries: 0 },
        "2d": { processed: false, output: null, error: null, retries: 0 },
        "3d": { processed: false, output: null, error: null, retries: 0 },
      };
    }

    const doc = await QuoteModel.create({
      quoteId: input.quoteId,
      parts: input.parts.map((p) => ({
        partId: p.partId,
        name: p.name,
      })),
      processing,
    });
    log.info("quote created", { quoteId: input.quoteId, partCount: input.parts.length });
    return doc.toObject();
  }

  async getQuote(quoteId: string): Promise<any | null> {
    return QuoteModel.findOne({ quoteId }).lean();
  }

  async submitForm(
    quoteId: string,
    formData: Record<string, unknown>,
    email: string,
  ): Promise<void> {
    const result = await QuoteModel.updateOne(
      { quoteId },
      { $set: { formData, email, formSubmitted: true } },
    );
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "submitForm",
        new Error(`Quote not found: ${quoteId}`),
      );
    }
  }

  async markPartFileUploaded(
    quoteId: string,
    partId: string,
    fileType: "2d" | "3d",
    fileKey?: string,
    fileName?: string,
  ): Promise<void> {
    const keyField = fileType === "2d" ? "file2DKey" : "file3DKey";
    const uploadedField =
      fileType === "2d" ? "file2DUploaded" : "file3DUploaded";
    const nameField = fileType === "2d" ? "file2DName" : "file3DName";

    const key = fileKey || buildPartKey(quoteId, partId, fileType as "2d" | "3d", fileName || partId);

    const set: Record<string, any> = {};
    set[`parts.$[elem].${keyField}`] = key;
    set[`parts.$[elem].${uploadedField}`] = true;
    if (fileName) set[`parts.$[elem].${nameField}`] = fileName;

    const result = await QuoteModel.updateOne(
      { quoteId },
      { $set: set },
      { arrayFilters: [{ "elem.partId": partId }] },
    );
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "markPartFileUploaded",
        new Error(`Quote or part not found: ${quoteId}/${partId}`),
      );
    }
    log.info("part file marked", { quoteId, partId, fileType });
  }

  async updatePartStage(
    quoteId: string,
    partId: string,
    stage: string,
    output: Record<string, unknown> | null,
    error?: string,
    retries?: number,
  ): Promise<void> {
    const prefix = `processing.${partId}.${stage}`;

    const set: Record<string, any> = {};
    set[`${prefix}.processed`] = true;
    if (output !== undefined) set[`${prefix}.output`] = output;
    if (error !== undefined) set[`${prefix}.error`] = error;
    if (retries !== undefined) set[`${prefix}.retries`] = retries;

    const result = await QuoteModel.updateOne(
      { quoteId },
      { $set: set },
    );
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "updatePartStage",
        new Error(`Quote or part not found: ${quoteId}/${partId}`),
      );
    }
  }

  async updatePartPresignedUrls(
    quoteId: string,
    partId: string,
    presignedUrl2D: string,
    presignedUrl3D: string,
    expiry: Date,
  ): Promise<void> {
    const result = await QuoteModel.updateOne(
      { quoteId },
      {
        $set: {
          "parts.$[elem].presignedUrl2D": presignedUrl2D,
          "parts.$[elem].presignedUrl3D": presignedUrl3D,
          "parts.$[elem].presignedUrlExpiry": expiry,
        },
      },
      { arrayFilters: [{ "elem.partId": partId }] },
    );
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "updatePartPresignedUrls",
        new Error(`Quote or part not found: ${quoteId}/${partId}`),
      );
    }
  }

  async updateQuoteStatus(
    quoteId: string,
    status: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    const set: Record<string, any> = { status };
    if (meta) Object.assign(set, meta);
    const result = await QuoteModel.updateOne({ quoteId }, { $set: set });
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "updateQuoteStatus",
        new Error(`Quote not found: ${quoteId}`),
      );
    }
    log.info("quote status updated", { quoteId, status, metaKeys: meta ? Object.keys(meta) : [] });
  }

  async markEmailSent(quoteId: string): Promise<void> {
    const result = await QuoteModel.updateOne(
      { quoteId },
      { $set: { emailSent: true, emailSentAt: new Date() } },
    );
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "markEmailSent",
        new Error(`Quote not found: ${quoteId}`),
      );
    }
  }

  async cancelQuote(quoteId: string): Promise<void> {
    const result = await QuoteModel.updateOne(
      { quoteId },
      { $set: { status: "CANCELLED" } },
    );
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "cancelQuote",
        new Error(`Quote not found: ${quoteId}`),
      );
    }
  }

  async findExpiredQuotes(expiryHours: number): Promise<any[]> {
    const cutoff = new Date(Date.now() - expiryHours * 60 * 60 * 1000);
    return QuoteModel.find({
      createdAt: { $lt: cutoff },
      status: { $nin: ["CANCELLED", "QUOTE_INFO_COMPLETE"] },
    }).lean();
  }

  async getQuoteStatus(quoteId: string): Promise<string | null> {
    const quote = await QuoteModel.findOne({ quoteId }, { status: 1 }).lean();
    return quote?.status ?? null;
  }

  async isPartStageProcessed(
    quoteId: string,
    partId: string,
    stage: string,
  ): Promise<boolean> {
    const quote = await QuoteModel.findOne({ quoteId }).lean();
    if (!quote) return false;

    const processing = (quote as any).processing?.[partId];
    if (!processing) return false;

    return !!(processing as any)[stage]?.processed;
  }

  async addToRetryQueue(entry: RetryQueueEntry): Promise<void> {
    await RetryQueueModel.create({
      quoteId: entry.quoteId,
      partId: entry.partId,
      stage: entry.stage as "form" | "2d" | "3d" | "mongoPersister" | "event_handler" | "batch_flush" | "dead_letter",
      error: entry.error,
      attempts: entry.attempts,
      status:
        (entry.status as "PENDING" | "RETRIED" | "ACKNOWLEDGED") || "PENDING",
    });
  }

  async getRetryQueue(filter?: RetryQueueFilter): Promise<RetryQueueEntry[]> {
    const query: Record<string, any> = {};
    if (filter?.status) query.status = filter.status;
    return RetryQueueModel.find(query).lean() as unknown as RetryQueueEntry[];
  }

  async markRetryStatus(
    quoteId: string,
    partId: string,
    status: string,
  ): Promise<void> {
    await RetryQueueModel.updateMany(
      { quoteId, partId },
      { $set: { status, retriedAt: new Date() } },
    );
  }

  async batchUpdate(
    quoteId: string,
    sets: Record<string, unknown>,
    arrayFilters?: Record<string, unknown>[],
  ): Promise<void> {
    const result = await QuoteModel.updateOne(
      { quoteId },
      { $set: sets as Record<string, any> },
      arrayFilters && arrayFilters.length > 0
        ? { arrayFilters: arrayFilters as Record<string, any>[] }
        : undefined,
    );
    if (result.matchedCount === 0) {
      throw new DatabaseError(
        "batchUpdate",
        new Error(`Quote not found: ${quoteId}`),
      );
    }
    log.info("batch update flushed", {
      quoteId,
      fieldCount: Object.keys(sets).length,
      arrayFilterCount: arrayFilters?.length ?? 0,
    });
  }
}

export default MongoDataService;
