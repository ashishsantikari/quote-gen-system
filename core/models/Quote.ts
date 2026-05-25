import mongoose, { Schema, Document } from "mongoose";

export interface IPart {
  partId: string;
  name: string;
  file2DKey?: string;
  file3DKey?: string;
  presignedUrl2D?: string;
  presignedUrl3D?: string;
  presignedUrlExpiry?: Date;
  file2DUploaded: boolean;
  file3DUploaded: boolean;
  formProcessed: boolean;
  file2DProcessed: boolean;
  file3DProcessed: boolean;
  formOutput?: Record<string, unknown>;
  file2DOutput?: Record<string, unknown>;
  file3DOutput?: Record<string, unknown>;
  formError?: string;
  file2DError?: string;
  file3DError?: string;
  formRetries: number;
  file2DRetries: number;
  file3DRetries: number;
}

export interface IQuote extends Document {
  quoteId: string;
  email?: string;
  formData?: Record<string, unknown>;
  parts: IPart[];
  formSubmitted: boolean;
  status: "QUOTE_INIT" | "QUOTE_FORM_UPLOAD_SUCCESS" | "QUOTE_INFO_COMPLETE" | "QUOTE_TIMED_OUT" | "CANCELLED";
  completionStatus?: "COMPLETE" | "COMPLETE_WITH_ERRORS" | "PARTIAL";
  emailSent: boolean;
  emailSentAt?: Date;
  transparency?: Record<string, unknown>;
  timeoutAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const PartSchema = new Schema<IPart>(
  {
    partId: { type: String, required: true },
    name: { type: String, required: true },
    file2DKey: { type: String },
    file3DKey: { type: String },
    presignedUrl2D: { type: String },
    presignedUrl3D: { type: String },
    presignedUrlExpiry: { type: Date },
    file2DUploaded: { type: Boolean, default: false },
    file3DUploaded: { type: Boolean, default: false },
    formProcessed: { type: Boolean, default: false },
    file2DProcessed: { type: Boolean, default: false },
    file3DProcessed: { type: Boolean, default: false },
    formOutput: { type: Schema.Types.Mixed },
    file2DOutput: { type: Schema.Types.Mixed },
    file3DOutput: { type: Schema.Types.Mixed },
    formError: { type: String },
    file2DError: { type: String },
    file3DError: { type: String },
    formRetries: { type: Number, default: 0 },
    file2DRetries: { type: Number, default: 0 },
    file3DRetries: { type: Number, default: 0 },
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
    transparency: { type: Schema.Types.Mixed },
    timeoutAt: { type: Date },
  },
  { timestamps: true }
);

export const QuoteModel = mongoose.model<IQuote>("Quote", QuoteSchema);

export interface IRetryQueue extends Document {
  quoteId: string;
  partId: string;
  stage: "form" | "2d" | "3d";
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
    partId: { type: String, required: true },
    stage: { type: String, enum: ["form", "2d", "3d"] },
    error: { type: String },
    attempts: { type: Number, default: 0 },
    status: { type: String, enum: ["PENDING", "RETRIED", "ACKNOWLEDGED"], default: "PENDING" },
    retriedAt: { type: Date },
  },
  { timestamps: true }
);

export const RetryQueueModel = mongoose.model<IRetryQueue>("RetryQueue", RetryQueueSchema);
