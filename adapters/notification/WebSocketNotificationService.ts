import type { ServerWebSocket } from "bun";
import type { INotificationService } from "../../core/ports/INotificationService";

type WSData = { url?: string; quoteId?: string };

export class WebSocketNotificationService implements INotificationService {
  private clients: Map<string, Set<ServerWebSocket<WSData>>> = new Map();

  async notify(quoteId: string, message: Record<string, unknown>): Promise<void> {
    const sockets = this.clients.get(quoteId);
    if (!sockets || sockets.size === 0) return;

    const data = JSON.stringify(message);

    for (const ws of sockets) {
      if (ws.readyState === 1) {
        ws.send(data);
      }
    }
  }

  handleUpgrade(req: Request): WSData | false {
    const url = new URL(req.url);
    const quoteId = url.searchParams.get("quoteId");
    if (!quoteId) return false;
    return { url: req.url, quoteId };
  }

  handleOpen(ws: ServerWebSocket<WSData>): void {
    const quoteId = ws.data?.quoteId;
    if (!quoteId) {
      ws.close(1008, "Missing quoteId");
      return;
    }

    if (!this.clients.has(quoteId)) {
      this.clients.set(quoteId, new Set());
    }
    this.clients.get(quoteId)!.add(ws);

    const originalClose = ws.close.bind(ws);
    ws.close = (code?: number, reason?: string) => {
      const set = this.clients.get(quoteId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          this.clients.delete(quoteId);
        }
      }
      originalClose(code, reason);
    };
  }
}

export default WebSocketNotificationService;
