import mongoose, { Schema, Document } from "mongoose";

export interface IPart {
  partId: string;
  name: string;
  file2DKey?: string;
  file3DKey?: string;
  file2DName?: string;
  file3DName?: string;
  presignedUrl2D?: string;
  presignedUrl3D?: string;
  presignedUrlExpiry?: Date;
  file2DUploaded: boolean;
  file3DUploaded: boolean;
}

export interface StageState {
  processed: boolean;
  output?: Record<string, unknown> | null;
  error?: string;
  retries: number;
}

export interface PartProcessingState {
  form: StageState;
  "2d": StageState;
  "3d": StageState;
}

export interface IQuote extends Document {
  quoteId: string;
  email?: string;
  formData?: Record<string, unknown>;
  parts: IPart[];
  formSubmitted: boolean;
  status: "QUOTE_INIT" | "QUOTE_FORM_UPLOAD_SUCCESS" | "QUOTE_INFO_COMPLETE" | "QUOTE_TIMED_OUT" | "CANCELLED";
  completionStatus?: "COMPLETE" | "COMPLETE_WITH_ERRORS" | "PARTIAL";
  processing: Record<string, PartProcessingState>;
  emailSent: boolean;
  emailSentAt?: Date;
  generatedData?: Record<string, unknown>;
  transparency?: Record<string, unknown>;
  pdfKey?: string;
  pdfUrl?: string;
  notificationChannel?: string;
  timeoutAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const StageStateSchema = new Schema<StageState>(
  {
    processed: { type: Boolean, default: false },
    output: { type: Schema.Types.Mixed },
    error: { type: String },
    retries: { type: Number, default: 0 },
  },
  { _id: false }
);

export const PartSchema = new Schema<IPart>(
  {
    partId: { type: String, required: true },
    name: { type: String, required: true },
    file2DKey: { type: String },
    file3DKey: { type: String },
    file2DName: { type: String },
    file3DName: { type: String },
    presignedUrl2D: { type: String },
    presignedUrl3D: { type: String },
    presignedUrlExpiry: { type: Date },
    file2DUploaded: { type: Boolean, default: false },
    file3DUploaded: { type: Boolean, default: false },
  },
  { _id: false }
);

export const QuoteSchema = new Schema<IQuote>(
  {
    quoteId: { type: String, required: true, unique: true, index: true },
    email: { type: String },
    formData: { type: Schema.Types.Mixed },
    parts: { type: [PartSchema], default: [] },
    formSubmitted: { type: Boolean, default: false },
    processing: { type: Map, of: new Schema({
      form: { type: StageStateSchema, default: () => ({ processed: false, retries: 0 }) },
      "2d": { type: StageStateSchema, default: () => ({ processed: false, retries: 0 }) },
      "3d": { type: StageStateSchema, default: () => ({ processed: false, retries: 0 }) },
    }, { _id: false }), default: {} },
    status: {
      type: String,
      enum: ["QUOTE_INIT", "QUOTE_FORM_UPLOAD_SUCCESS", "QUOTE_INFO_COMPLETE", "QUOTE_TIMED_OUT", "CANCELLED"],
      default: "QUOTE_INIT",
    },
    completionStatus: {
      type: String,
      enum: ["COMPLETE", "COMPLETE_WITH_ERRORS", "PARTIAL"],
    },
    emailSent: { type: Boolean, default: false },
    emailSentAt: { type: Date },
    generatedData: { type: Schema.Types.Mixed },
    transparency: { type: Schema.Types.Mixed },
    pdfKey: { type: String },
    pdfUrl: { type: String },
    notificationChannel: { type: String },
    timeoutAt: { type: Date },
  },
  { timestamps: true }
);

let QuoteModel: mongoose.Model<IQuote>;
try {
  QuoteModel = mongoose.model<IQuote>("Quote");
} catch {
  QuoteModel = mongoose.model<IQuote>("Quote", QuoteSchema);
}
export { QuoteModel };

export interface IRetryQueue extends Document {
  quoteId: string;
  partId?: string;
  stage?: "form" | "2d" | "3d" | "mongoPersister" | "event_handler" | "batch_flush" | "dead_letter";
  error: string;
  attempts: number;
  status: "PENDING" | "RETRIED" | "ACKNOWLEDGED";
  retriedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const RetryQueueSchema = new Schema<IRetryQueue>(
  {
    quoteId: { type: String, required: true },
    partId: { type: String, required: false },
    stage: { type: String, enum: ["form", "2d", "3d", "mongoPersister", "event_handler", "batch_flush", "dead_letter"] },
    error: { type: String },
    attempts: { type: Number, default: 0 },
    status: { type: String, enum: ["PENDING", "RETRIED", "ACKNOWLEDGED"], default: "PENDING" },
    retriedAt: { type: Date },
  },
  { timestamps: true }
);

let RetryQueueModel: mongoose.Model<IRetryQueue>;
try {
  RetryQueueModel = mongoose.model<IRetryQueue>("RetryQueue");
} catch {
  RetryQueueModel = mongoose.model<IRetryQueue>("RetryQueue", RetryQueueSchema);
}
export { RetryQueueModel };
