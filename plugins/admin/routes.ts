import type { ServerRoute } from "@hapi/hapi";
import Joi from "joi";
import { QUOTE_ID_PATTERN } from "../../core/ids";
import { getRetryQueueHandler, retryQuoteHandler } from "./handlers";

const AdminRoutes: ServerRoute[] = [
  {
    method: "GET",
    path: "/admin/retry-queue",
    handler: getRetryQueueHandler,
    options: {
      description: "List all entries in the retry queue",
      notes: "Shows failed operations that require manual retry.",
      tags: ["api", "admin"],
    },
  },
  {
    method: "POST",
    path: "/admin/retry/{quoteId}",
    handler: retryQuoteHandler,
    options: {
      description: "Manually re-process a failed quote by re-publishing its original events",
      tags: ["api", "admin"],
      validate: {
        params: Joi.object({
          quoteId: Joi.string().pattern(QUOTE_ID_PATTERN).required().description("Quote ID to retry"),
        }).required(),
        failAction: (_request, _h, err) => { throw err; },
      },
    },
  },
];

export default AdminRoutes;
