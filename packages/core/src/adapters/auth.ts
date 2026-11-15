import type { Actor, Comment, Group, Thread } from "../models.js";
import type { Unsubscribe } from "./storage.js";

export type AuthAction =
  | "thread:read"
  | "thread:create"
  | "thread:update"
  | "thread:delete"
  | "thread:resolve"
  | "comment:create"
  | "comment:update"
  | "comment:delete"
  | "group:manage"
  | "audit:read";

export interface AuthorizationRequest {
  actor: Actor | null;
  action: AuthAction;
  thread?: Thread;
  comment?: Comment;
  group?: Group;
}

/**
 * Who is annotating, and what they may do. Wrap your own auth (Clerk,
 * Auth.js, WorkOS, a session cookie) behind this.
 */
export interface AuthAdapter {
  /** The current actor, or `null` when signed out or anonymous. */
  getActor(): Promise<Actor | null>;
  /** Notified when the actor changes, for example on sign-in. */
  onChange?(listener: (actor: Actor | null) => void): Unsubscribe;
  signIn?(): Promise<Actor | null>;
  signOut?(): Promise<void>;
  /** A bearer token for remote storage adapters to send. */
  getAccessToken?(): Promise<string | null>;
  /** Permission check. When absent, any signed-in actor may do anything. */
  authorize?(request: AuthorizationRequest): Promise<boolean>;
}

/** An auth adapter that always returns the same actor. Handy for demos, tests and local agents. */
export function createStaticAuth(actor: Actor | null): AuthAdapter {
  return {
    getActor: async () => actor,
  };
}
