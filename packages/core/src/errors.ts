export type AnnotateKitErrorCode =
  | "not_found"
  | "conflict"
  | "invalid_input"
  | "unauthorized"
  | "forbidden"
  | "not_allowed"
  | "invalid_transition"
  | "storage_unavailable";

export class AnnotateKitError extends Error {
  readonly code: AnnotateKitErrorCode;

  constructor(code: AnnotateKitErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AnnotateKitError";
    this.code = code;
  }
}

export function isAnnotateKitError(value: unknown): value is AnnotateKitError {
  return value instanceof AnnotateKitError;
}
