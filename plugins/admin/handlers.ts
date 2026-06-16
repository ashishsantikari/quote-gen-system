import type { Request, ResponseToolkit, Lifecycle } from "@hapi/hapi";
import type { IDataService } from "../../core/ports/IDataService";
import type { IEventBus } from "../../core/ports/IEventBus";
import { EventType } from "../../core/events/types";
import { httpErrorResponse } from "../../core/errors";
import { getRequestTraceId } from "../logging";

function getServices(request: Request) {
  const plugins = request.server.plugins as Record<string, any>;
  const { dataService, eventBus } = plugins.admin;
  return { dataService, eventBus } as {
    dataService: IDataService;
    eventBus: IEventBus;
  };
}

function errorReply(h: ResponseToolkit, error: unknown, request: Request): Lifecycle.ReturnValue {
  const traceId = getRequestTraceId(request);
  const { statusCode, body } = httpErrorResponse(error, traceId);
  return h.response(body).code(statusCode);
}

export async function getRetryQueueHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  try {
    const { dataService } = getServices(request);
    const entries = await dataService.getRetryQueue();
    return h.response({ entries }).code(200);
  } catch (error) {
    return errorReply(h, error, request);
  }
}

export async function retryQuoteHandler(request: Request, h: ResponseToolkit): Promise<Lifecycle.ReturnValue> {
  try {
    const { eventBus } = getServices(request);
    const { quoteId } = request.params as { quoteId: string };

    await eventBus.publish({
      type: EventType.admin_retry_command,
      payload: { quoteId },
    });

    return h.response({ success: true, quoteId }).code(200);
  } catch (error) {
    return errorReply(h, error, request);
  }
}
