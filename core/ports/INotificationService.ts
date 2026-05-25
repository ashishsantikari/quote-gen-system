export interface INotificationService {
  notify(quoteId: string, message: Record<string, unknown>): Promise<void>;
}
