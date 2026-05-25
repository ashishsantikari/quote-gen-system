export interface IEmailService {
  sendQuoteEmail(to: string, subject: string, body: string, attachments?: EmailAttachment[]): Promise<void>;
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType?: string;
}
