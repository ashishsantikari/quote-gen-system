import type { Request, ResponseToolkit, Lifecycle } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";

function getServices(request: Request) {
  const plugins = request.server.plugins as Record<string, any>;
  const { dataService, eventBus } = plugins.admin;
  return { dataService, eventBus } as {
    dataService: IDataService;
    eventBus: IEventBus;
  };
}

export async function getRetryQueueHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const { dataService } = getServices(request);
  const entries = await dataService.getRetryQueue();
  return h.response({ entries }).code(200);
}

export async function retryQuoteHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  const { eventBus } = getServices(request);
  const { quoteId } = request.params as { quoteId: string };

  await eventBus.publish({
    type: EventType.RetryCommand,
    payload: { quoteId },
  });

  return h.response({ success: true, quoteId }).code(200);
}
