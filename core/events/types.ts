export const EventType = {
  init_quote_creation_request: "init_quote_creation_request",
  init_quote_form_upload: "init_quote_form_upload",
  init_quote_part_2d_file_upload: "init_quote_part_2d_file_upload",
  init_quote_part_3d_file_upload: "init_quote_part_3d_file_upload",
  part_form_complete: "part_form_complete",
  part_2d_complete: "part_2d_complete",
  part_3d_complete: "part_3d_complete",
  part_processing_complete: "part_processing_complete",
  quote_data_normalization_begin: "quote_data_normalization_begin",
  quote_data_normalization_complete: "quote_data_normalization_complete",
  quote_data_normalization_timed_out: "quote_data_normalization_timed_out",
  quote_ready: "quote_ready",
  quote_pdf_complete: "quote_pdf_complete",
  quote_email_send: "quote_email_send",
  quote_notification_send: "quote_notification_send",
  error_operation_fail: "error_operation_fail",
  admin_retry_command: "admin_retry_command",
  quote_all_mandatory_data_receipt: "quote_all_mandatory_data_receipt",
  quote_cancel: "quote_cancel",
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

export interface InitQuoteCreationRequestPayload {
  quoteId: string;
  parts: PartInfo[];
}

export interface InitQuoteFormUploadPayload {
  quoteId: string;
  formData: Record<string, unknown>;
  email: string;
}

export interface InitQuotePart2DFileUploadPayload {
  quoteId: string;
  partId: string;
  fileKey: string;
  fileName: string;
}

export interface InitQuotePart3DFileUploadPayload {
  quoteId: string;
  partId: string;
  fileKey: string;
  fileName: string;
}

export interface PartFormCompletePayload {
  quoteId: string;
  partId: string;
  output: Record<string, unknown> | null;
  error?: string;
  retries?: number;
}

export interface Part2DCompletePayload {
  quoteId: string;
  partId: string;
  output: Record<string, unknown> | null;
  error?: string;
  retries?: number;
}

export interface Part3DCompletePayload {
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

export interface QuoteDataNormalizationBeginPayload {
  quoteId: string;
}

export interface QuoteDataNormalizationCompletePayload {
  quoteId: string;
  completionStatus: "COMPLETE" | "COMPLETE_WITH_ERRORS";
}

export interface QuoteDataNormalizationTimedOutPayload {
  quoteId: string;
  completedParts: string[];
  pendingParts: PendingPartInfo[];
  timeoutAt: string;
}

export interface QuoteReadyPayload {
  quoteId: string;
  generatedData: Record<string, unknown>;
  transparency: TransparencyReport;
}

export interface QuotePdfCompletePayload {
  quoteId: string;
  pdfKey: string;
  pdfUrl: string;
}

export interface QuoteEmailSendPayload {
  quoteId: string;
  sentAt: string;
}

export interface QuoteNotificationSendPayload {
  quoteId: string;
  channel: string;
}

export interface ErrorOperationFailPayload {
  quoteId: string;
  partId?: string;
  stage?: string;
  error: string;
  attempts: number;
}

export interface AdminRetryCommandPayload {
  quoteId: string;
}

export interface QuoteAllMandatoryDataReceiptPayload {
  quoteId: string;
  receivedAt: string;
}

export interface QuoteCancelPayload {
  quoteId: string;
  reason: "EXPIRED";
}

export interface EventMetadata {
  traceId?: string;
  spanId?: string;
}

export type QuoteEvent =
  | ({ type: typeof EventType.init_quote_creation_request; payload: InitQuoteCreationRequestPayload } & EventMetadata)
  | ({ type: typeof EventType.init_quote_form_upload; payload: InitQuoteFormUploadPayload } & EventMetadata)
  | ({ type: typeof EventType.init_quote_part_2d_file_upload; payload: InitQuotePart2DFileUploadPayload } & EventMetadata)
  | ({ type: typeof EventType.init_quote_part_3d_file_upload; payload: InitQuotePart3DFileUploadPayload } & EventMetadata)
  | ({ type: typeof EventType.part_form_complete; payload: PartFormCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.part_2d_complete; payload: Part2DCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.part_3d_complete; payload: Part3DCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.part_processing_complete; payload: PartProcessingCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.quote_data_normalization_begin; payload: QuoteDataNormalizationBeginPayload } & EventMetadata)
  | ({ type: typeof EventType.quote_data_normalization_complete; payload: QuoteDataNormalizationCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.quote_data_normalization_timed_out; payload: QuoteDataNormalizationTimedOutPayload } & EventMetadata)
  | ({ type: typeof EventType.quote_ready; payload: QuoteReadyPayload } & EventMetadata)
  | ({ type: typeof EventType.quote_pdf_complete; payload: QuotePdfCompletePayload } & EventMetadata)
  | ({ type: typeof EventType.quote_email_send; payload: QuoteEmailSendPayload } & EventMetadata)
  | ({ type: typeof EventType.quote_notification_send; payload: QuoteNotificationSendPayload } & EventMetadata)
  | ({ type: typeof EventType.error_operation_fail; payload: ErrorOperationFailPayload } & EventMetadata)
  | ({ type: typeof EventType.admin_retry_command; payload: AdminRetryCommandPayload } & EventMetadata)
  | ({ type: typeof EventType.quote_all_mandatory_data_receipt; payload: QuoteAllMandatoryDataReceiptPayload } & EventMetadata)
  | ({ type: typeof EventType.quote_cancel; payload: QuoteCancelPayload } & EventMetadata);
