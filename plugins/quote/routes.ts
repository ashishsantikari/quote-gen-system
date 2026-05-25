import type { ServerRoute } from "@hapi/hapi";
import Joi from "joi";
import { QUOTE_ID_PATTERN, PART_ID_PATTERN } from "../../core/ids";
import {
  createQuoteHandler,
  confirmFileHandler,
  submitFormHandler,
  getQuoteHandler,
  regenerateUrlHandler,
} from "./handlers";

const QuoteRoutes: ServerRoute[] = [
  {
    method: "POST",
    path: "/quote/create",
    handler: createQuoteHandler,
    options: {
      description: "Create a new quote with parts list. Returns presigned PUT URLs for 2D and 3D files per part.",
      notes: "Generates S3 presigned URLs so clients can upload files directly to object storage.",
      tags: ["api", "quote"],
      validate: {
        payload: Joi.object({
          parts: Joi.array()
            .items(Joi.object({ name: Joi.string().required().min(1).description("Part name/identifier") }))
            .min(1)
            .required()
            .description("List of parts in the quote"),
        }).required(),
        failAction: (_request, _h, err) => { throw err; },
      },
    },
  },
  {
    method: "POST",
    path: "/quote/{quoteId}/part/{partId}/confirm",
    handler: confirmFileHandler,
    options: {
      description: "Confirm that a file has been uploaded by the client via presigned URL",
      tags: ["api", "quote"],
      validate: {
        params: Joi.object({
          quoteId: Joi.string().pattern(QUOTE_ID_PATTERN).required().description("Quote ID"),
          partId: Joi.string().pattern(PART_ID_PATTERN).required().description("Part ID"),
        }).required(),
        payload: Joi.object({
          type: Joi.string().valid("2d", "3d").required().description("File type: 2d or 3d"),
        }).required(),
        failAction: (_request, _h, err) => { throw err; },
      },
    },
  },
  {
    method: "POST",
    path: "/quote/{quoteId}/form",
    handler: submitFormHandler,
    options: {
      description: "Submit form data and email for a quote",
      tags: ["api", "quote"],
      validate: {
        params: Joi.object({
          quoteId: Joi.string().pattern(QUOTE_ID_PATTERN).required().description("Quote ID"),
        }).required(),
        payload: Joi.object({
          formData: Joi.object().default({}).description("Arbitrary form data key-value pairs"),
          email: Joi.string().email().required().description("User email address for receiving the generated quote"),
        }).required(),
        failAction: (_request, _h, err) => { throw err; },
      },
    },
  },
  {
    method: "GET",
    path: "/quote/{quoteId}",
    handler: getQuoteHandler,
    options: {
      description: "Retrieve a quote with full status, parts, and processing outputs",
      tags: ["api", "quote"],
      validate: {
        params: Joi.object({
          quoteId: Joi.string().pattern(QUOTE_ID_PATTERN).required().description("Quote ID"),
        }).required(),
        failAction: (_request, _h, err) => { throw err; },
      },
    },
  },
  {
    method: "POST",
    path: "/quote/{quoteId}/regenerate-url",
    handler: regenerateUrlHandler,
    options: {
      description: "Regenerate an expired presigned upload URL for a specific part and file type",
      tags: ["api", "quote"],
      validate: {
        params: Joi.object({
          quoteId: Joi.string().pattern(QUOTE_ID_PATTERN).required().description("Quote ID"),
        }).required(),
        payload: Joi.object({
          partId: Joi.string().pattern(PART_ID_PATTERN).required().description("Part ID"),
          type: Joi.string().valid("2d", "3d").required().description("File type: 2d or 3d"),
        }).required(),
        failAction: (_request, _h, err) => { throw err; },
      },
    },
  },
];

export default QuoteRoutes;
