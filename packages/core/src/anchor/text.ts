import type { TextQuote } from "./types.js";

/** Collapse whitespace and trim, so layout changes don't change the fingerprint. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** 32-bit FNV-1a hash of the normalised text, as 8 hex characters. */
export function fingerprintText(text: string): string {
  const normalized = normalizeText(text);
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export interface TextQuoteOptions {
  prefix?: string;
  suffix?: string;
  /** Longest `exact` kept, in characters. Defaults to 280. */
  maxLength?: number;
  /** Longest prefix and suffix kept, in characters. Defaults to 32. */
  contextLength?: number;
}

/** Build a {@link TextQuote} from raw element text and optional surrounding text. */
export function createTextQuote(text: string, options: TextQuoteOptions = {}): TextQuote {
  const maxLength = options.maxLength ?? 280;
  const contextLength = options.contextLength ?? 32;
  const exact = truncate(normalizeText(text), maxLength);
  const quote: TextQuote = { exact, fingerprint: fingerprintText(exact) };
  if (options.prefix) {
    const prefix = normalizeText(options.prefix).slice(-contextLength);
    if (prefix) quote.prefix = prefix;
  }
  if (options.suffix) {
    const suffix = normalizeText(options.suffix).slice(0, contextLength);
    if (suffix) quote.suffix = suffix;
  }
  return quote;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}
