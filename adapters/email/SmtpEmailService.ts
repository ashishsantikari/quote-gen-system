import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { IEmailService, EmailAttachment } from "../../core/ports/IEmailService";

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export class SmtpEmailService implements IEmailService {
  private transporter: Transporter;

  constructor(config: SmtpConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: {
        user: config.user,
        pass: config.pass,
      },
    });
  }

  async sendQuoteEmail(
    to: string,
    subject: string,
    body: string,
    attachments?: EmailAttachment[]
  ): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html: body,
      attachments: attachments?.map((att) => ({
        filename: att.filename,
        content: att.content,
        contentType: att.contentType,
      })),
    });
  }
}

export function createSmtpEmailServiceFromEnv(): SmtpEmailService {
  return new SmtpEmailService({
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
  });
}

export default SmtpEmailService;
