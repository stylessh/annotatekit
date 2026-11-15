import { AnnotateKitError } from "../errors.js";
import type {
  Actor,
  Resolution,
  ResolutionReference,
  Thread,
  ThreadStatus,
  Timestamp,
} from "../models.js";
import { canTransition } from "../status.js";

export interface ResolveRequest {
  thread: Thread;
  actor: Actor;
  note?: string;
  reference?: ResolutionReference;
}

export interface ReopenRequest {
  thread: Thread;
  actor: Actor;
  reason?: string;
}

/** The status and resolution record the thread should be saved with. */
export interface ResolutionOutcome {
  status: ThreadStatus;
  resolution?: Resolution;
}

/**
 * Decides what "resolve" means. A manual adapter closes the thread at once;
 * a review adapter can park agent fixes in `pending_review`; a tracker
 * adapter can sync status to Linear or GitHub.
 */
export interface ResolutionAdapter {
  resolve(request: ResolveRequest): Promise<ResolutionOutcome>;
  reopen?(request: ReopenRequest): Promise<ResolutionOutcome>;
  /** Called after the outcome is stored, to sync with external systems. */
  onResolved?(thread: Thread): Promise<void>;
}

export interface ResolutionOptions {
  now?: () => Timestamp;
}

/** Anyone allowed to resolve closes the thread immediately. */
export function createManualResolution(options: ResolutionOptions = {}): ResolutionAdapter {
  const now = options.now ?? defaultNow;
  return {
    async resolve({ thread, actor, note, reference }) {
      assertTransition(thread.status, "resolved");
      return { status: "resolved", resolution: buildResolution(actor, now(), note, reference) };
    },
    async reopen({ thread }) {
      assertTransition(thread.status, "open");
      return { status: "open" };
    },
  };
}

export interface ReviewResolutionOptions extends ResolutionOptions {
  /**
   * Whether a resolve by this actor needs a human review first. Defaults to
   * requiring review for agents.
   */
  requiresReview?: (actor: Actor, thread: Thread) => boolean;
  /** Whether this actor may approve a pending fix. Defaults to any human. */
  canReview?: (actor: Actor, thread: Thread) => boolean;
}

/**
 * Agent fixes go to `pending_review`. A human resolving a `pending_review`
 * thread approves it, keeping the original resolver and recording the reviewer.
 */
export function createReviewResolution(options: ReviewResolutionOptions = {}): ResolutionAdapter {
  const now = options.now ?? defaultNow;
  const requiresReview = options.requiresReview ?? ((actor) => actor.kind === "agent");
  const canReview = options.canReview ?? ((actor) => actor.kind === "human");

  return {
    async resolve({ thread, actor, note, reference }) {
      const at = now();
      if (thread.status === "pending_review" && thread.resolution) {
        if (!canReview(actor, thread)) {
          throw new AnnotateKitError("forbidden", `${actor.name} cannot approve this fix`);
        }
        return {
          status: "resolved",
          resolution: { ...thread.resolution, reviewedBy: actor, reviewedAt: at },
        };
      }
      const status: ThreadStatus = requiresReview(actor, thread) ? "pending_review" : "resolved";
      assertTransition(thread.status, status);
      return { status, resolution: buildResolution(actor, at, note, reference) };
    },
    async reopen({ thread }) {
      assertTransition(thread.status, "open");
      return { status: "open" };
    },
  };
}

function buildResolution(
  actor: Actor,
  at: Timestamp,
  note: string | undefined,
  reference: ResolutionReference | undefined,
): Resolution {
  const resolution: Resolution = { resolvedBy: actor, resolvedAt: at };
  if (note !== undefined) resolution.note = note;
  if (reference !== undefined) resolution.reference = reference;
  return resolution;
}

function assertTransition(from: ThreadStatus, to: ThreadStatus): void {
  if (!canTransition(from, to)) {
    throw new AnnotateKitError("invalid_transition", `Cannot move a thread from ${from} to ${to}`);
  }
}

function defaultNow(): Timestamp {
  return new Date().toISOString();
}
