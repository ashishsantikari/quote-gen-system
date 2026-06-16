import crypto from "crypto";

type ResourcePrefix = "q" | "p";

export function generateId(prefix: ResourcePrefix): string {
  const hex = crypto.randomBytes(6).toString("hex");
  return `${prefix}-${hex}`;
}

export const QUOTE_ID_PATTERN = /^q-[a-f0-9]{12}$/;
export const PART_ID_PATTERN = /^p-[a-f0-9]{12}$/;

export const S3_BUCKET = process.env.S3_BUCKET || "quote-gen-uploads";

export function buildPartKey(quoteId: string, partId: string, fileType: "2d" | "3d", fileName: string): string {
  return `quotes/${quoteId}/parts/${partId}/${fileType}/${fileName}`;
}

export function buildPdfKey(quoteId: string): string {
  return `quotes/${quoteId}/output/quote.pdf`;
}

export interface ParsedS3Key {
  quoteId: string;
  partId: string;
  fileType: "2d" | "3d";
  fileName: string;
  decodedKey: string;
}

export function parseS3Key(key: string): ParsedS3Key | null {
  const decoded = decodeURIComponent(key.replace(/\+/g, " "));
  const parts = decoded.split("/");

  if (parts.length < 5) return null;

  const quoteId = parts[1];
  const partId = parts[3];
  const fileType = parts[4];
  const fileName = parts.slice(5).join("/");

  if (parts[0] !== "quotes" || parts[2] !== "parts") return null;
  if (!quoteId || !partId || !fileType) return null;
  if (fileType !== "2d" && fileType !== "3d") return null;

  return { quoteId, partId, fileType, fileName: fileName || partId, decodedKey: decoded };
}
