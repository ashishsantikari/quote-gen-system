import type { Plugin, Request, ResponseToolkit } from "@hapi/hapi";
import { Logger } from "../../core/telemetry/logger";
import { metrics } from "../../core/telemetry/metrics";
import { v4 as uuidv4 } from "uuid";

const log = new Logger({ component: "api-gateway" });
const REQUEST_TRACE_KEY = "request-trace-id";

const LoggingPlugin: Plugin<void> = {
  name: "logging",
  version: "1.0.0",
  register: async (server) => {
    server.ext("onRequest", (request: Request, h: ResponseToolkit) => {
      const traceId = uuidv4();
      (request.app as Record<string, unknown>)[REQUEST_TRACE_KEY] = traceId;
      const start = Date.now();

      request.events.on("finish", () => {
        const duration = Date.now() - start;
        const statusCode = (request.response && typeof request.response === "object" && "statusCode" in request.response)
          ? String(request.response.statusCode)
          : "unknown";

        metrics.httpRequests.inc({ method: request.method.toUpperCase(), path: request.path, status: statusCode });
        metrics.httpRequestDuration.observe(duration, { path: request.path });

        log.info("request", {
          traceId,
          method: request.method.toUpperCase(),
          path: request.path,
          statusCode,
          durationMs: duration,
        });
      });

      return h.continue;
    });
  },
};

export function getRequestTraceId(request: Request): string {
  return ((request.app as Record<string, unknown>)[REQUEST_TRACE_KEY] as string) || "unknown";
}

export default LoggingPlugin;
