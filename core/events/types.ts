export const EventType = {
  QuoteCreated: "QuoteCreated",
  FormUploaded: "FormUploaded",
  FileUploaded: "FileUploaded",
  PartFormProcessed: "PartFormProcessed",
  Part2DProcessed: "Part2DProcessed",
  Part3DProcessed: "Part3DProcessed",
  PartProcessingComplete: "PartProcessingComplete",
  QuoteInfoComplete: "QuoteInfoComplete",
  QuoteTimedOut: "QuoteTimedOut",
  QuoteGenerated: "QuoteGenerated",
  PdfGenerated: "PdfGenerated",
  EmailSent: "EmailSent",
  NotificationSent: "NotificationSent",
  OperationFailed: "OperationFailed",
  RetryCommand: "RetryCommand",
  QuoteCancelled: "QuoteCancelled",
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

export interface PartInfo {
  partId: string;
  name: string;
}

export interface PendingPartInfo {
  partId: string;
  pendingStages: ("form" | "2d" | "3d")[];
}

export interface TransparencyReport {
  totalStages: number;
  successful: number;
  errored: number;
  timedOut: number;
  dataCompleteness: string;
  assumptions: string[];
}

export interface QuoteCreatedPayload {
  quoteId: string;
  parts: PartInfo[];
}

export interface FormUploadedPayload {
  quoteId: string;
  formData: Record<string, unknown>;
  email: string;
}

export interface FileUploadedPayload {
  quoteId: string;
  partId: string;
  fileType: "2d" | "3d";
  fileKey: string;
}

export interface PartFormProcessedPayload {
  quoteId: string;
  partId: string;
  output: Record<string, unknown> | null;
  error?: string;
  retries?: number;
}

export interface Part2DProcessedPayload {
  quoteId: string;
  partId: string;
  output: Record<string, unknown> | null;
  error?: string;
  retries?: number;
}

export interface Part3DProcessedPayload {
  quoteId: string;
  partId: string;
  output: Record<string, unknown> | null;
  error?: string;
  retries?: number;
}

export interface PartProcessingCompletePayload {
  quoteId: string;
  partId: string;
}

export interface QuoteInfoCompletePayload {
  quoteId: string;
  completionStatus: "COMPLETE" | "COMPLETE_WITH_ERRORS";
}

export interface QuoteTimedOutPayload {
  quoteId: string;
  completedParts: string[];
  pendingParts: PendingPartInfo[];
  timeoutAt: string;
}

export interface QuoteGeneratedPayload {
  quoteId: string;
  generatedData: Record<string, unknown>;
  transparency: TransparencyReport;
}

export interface PdfGeneratedPayload {
  quoteId: string;
  pdfKey: string;
  pdfUrl: string;
}

export interface EmailSentPayload {
  quoteId: string;
  sentAt: string;
}

export interface NotificationSentPayload {
  quoteId: string;
  channel: string;
}

export interface OperationFailedPayload {
  quoteId: string;
  partId?: string;
  stage?: string;
  error: string;
  attempts: number;
}

export interface RetryCommandPayload {
  quoteId: string;
}

export interface QuoteCancelledPayload {
  quoteId: string;
  reason: "EXPIRED";
}

export interface EventMetadata {
  traceId?: string;
  spanId?: string;
}

export type QuoteEvent =
  | ({ type: typeof EventType.QuoteCreated; payload: QuoteCreatedPayload } & EventMetadata)
  | ({ type: typeof EventType.FormUploaded; payload: FormUploadedPayload } & EventMetadata)
  | ({ type: typeof EventType.FileUploaded; payload: FileUploadedPayload } & EventMetadata)
  | ({ type: typeof EventType.PartFormProcessed; payload: PartFormProcessedPayload } & EventMetadata)
  | ({ type: typeof EventType.Part2DProcessed; payload: Part2DProcessedPayload } & EventMetadata)
  | ({ type: typeof EventType.Part3DProcessed; payload: Part3DProcessedPayload } & EventMetadata)
  | ({ type: typeof EventType.PartProcessingComplete; payload: PartProcessingCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.QuoteInfoComplete; payload: QuoteInfoCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.QuoteTimedOut; payload: QuoteTimedOutPayload } & EventMetadata)
  | ({ type: typeof EventType.QuoteGenerated; payload: QuoteGeneratedPayload } & EventMetadata)
  | ({ type: typeof EventType.PdfGenerated; payload: PdfGeneratedPayload } & EventMetadata)
  | ({ type: typeof EventType.EmailSent; payload: EmailSentPayload } & EventMetadata)
  | ({ type: typeof EventType.NotificationSent; payload: NotificationSentPayload } & EventMetadata)
  | ({ type: typeof EventType.OperationFailed; payload: OperationFailedPayload } & EventMetadata)
  | ({ type: typeof EventType.RetryCommand; payload: RetryCommandPayload } & EventMetadata)
  | ({ type: typeof EventType.QuoteCancelled; payload: QuoteCancelledPayload } & EventMetadata);
