import type { Plugin, Request, ResponseToolkit } from "@hapi/hapi";

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";
const CSRF_APP_KEY = "csrf-token-value";

const SKIP_PATHS = ["/docs", "/swagger", "/redoc", "/admin"];
const isProduction = process.env.NODE_ENV === "production";

function shouldSkipCSRF(path: string): boolean {
  return !isProduction || SKIP_PATHS.some((p) => path.startsWith(p));
}

const CsrfPlugin: Plugin<void> = {
  name: "csrf",
  version: "1.0.0",
  register: async (server) => {
    server.state(CSRF_COOKIE, {
      isSecure: false,
      isHttpOnly: false,
      path: "/",
      encoding: "none",
    });

    server.ext("onPostAuth", (request: Request, h: ResponseToolkit) => {
      if (shouldSkipCSRF(request.path) || request.method.toUpperCase() === "GET") {
        return h.continue;
      }

      const headerToken = request.headers[CSRF_HEADER];
      const cookieToken = request.state?.[CSRF_COOKIE] as string | undefined;

      if (!cookieToken || !headerToken || headerToken !== cookieToken) {
        return h.response({ error: "Invalid CSRF token" }).code(403).takeover();
      }

      return h.continue;
    });

    server.ext("onPreResponse", (request: Request, h: ResponseToolkit) => {
      const existing = request.state?.[CSRF_COOKIE] as string | undefined;
      if (!existing && typeof request.response !== "symbol") {
        const response = request.response;
        if ("header" in response) {
          h.state(CSRF_COOKIE, crypto.randomUUID());
        }
      }
      return h.continue;
    });
  },
};

export default CsrfPlugin;
