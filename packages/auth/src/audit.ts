import type { AuditEventInput, AuditLog } from "@annotatekit/core";

/** Writes to the audit log without ever failing the request it describes. */
export async function recordAudit(audit: AuditLog | undefined, event: AuditEventInput) {
  if (!audit) return;
  try {
    await audit.record(event);
  } catch (error) {
    console.error("[annotatekit] could not write the audit log", error);
  }
}

/** A short, single-line reason from a thrown value. */
export function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 200);
}
