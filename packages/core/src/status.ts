import type { ThreadStatus } from "./models.js";

const transitions: Record<ThreadStatus, readonly ThreadStatus[]> = {
  open: ["in_progress", "pending_review", "resolved", "dismissed"],
  in_progress: ["open", "pending_review", "resolved", "dismissed"],
  pending_review: ["in_progress", "open", "resolved", "dismissed"],
  resolved: ["open"],
  dismissed: ["open"],
};

export const THREAD_STATUSES: readonly ThreadStatus[] = Object.keys(transitions) as ThreadStatus[];

/** Whether a thread may move from one status to another. Reopening is always allowed. */
export function canTransition(from: ThreadStatus, to: ThreadStatus): boolean {
  return transitions[from].includes(to);
}

/** Statuses that count as closed. */
export function isClosedStatus(status: ThreadStatus): boolean {
  return status === "resolved" || status === "dismissed";
}
