import { AnnotateKitError } from "../errors.js";
import type { CommentAttachment } from "../models.js";

/** A file picked or pasted in the UI, before it is stored anywhere. */
export interface AttachmentFile {
  name: string;
  /** MIME type, e.g. `image/png`. May be empty when the browser doesn't know. */
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface AttachmentUploadContext {
  projectId: string;
  /** Missing while the thread is being created along with its first comment. */
  threadId?: string;
}

/**
 * Stores comment attachments somewhere and returns what the comment keeps:
 * usually a URL. Plug in S3, R2, your CDN or your app's upload endpoint.
 */
export interface AttachmentAdapter {
  upload(file: AttachmentFile, context: AttachmentUploadContext): Promise<CommentAttachment>;
}

export interface DataUrlAttachmentOptions {
  /** Largest file accepted, in bytes. Defaults to 512 KB, so comments fit in a 1 MB request. */
  maxBytes?: number;
}

/** Most attachments a single comment can carry. */
export const MAX_ATTACHMENTS = 10;

const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp|avif|svg\+xml)$/;

export function isImageType(mimeType: string | undefined): boolean {
  return !!mimeType && IMAGE_TYPES.test(mimeType);
}

/**
 * Whether a URL is safe to put in an `<img src>` or a download link:
 * `https:`, `http:`, `blob:` or a base64 `data:` URL. Rejects `javascript:` and friends.
 */
export function isSafeAttachmentUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length === 0) return false;
  if (/^data:[\w.+-]+\/[\w.+-]+(;[\w=.+-]+)*;base64,[A-Za-z0-9+/=]*$/.test(url)) return true;
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" || protocol === "blob:";
  } catch {
    return false;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Keeps attachments inline in the comment as `data:` URLs. Needs no server,
 * so it is the default for local storage and demos; use a real upload adapter
 * for anything large.
 */
export function createDataUrlAttachmentAdapter(
  options: DataUrlAttachmentOptions = {},
): AttachmentAdapter {
  const maxBytes = options.maxBytes ?? 512 * 1024;
  return {
    async upload(file) {
      if (file.size > maxBytes) {
        throw new AnnotateKitError(
          "invalid_input",
          `${file.name} is larger than ${Math.round(maxBytes / 1024)} KB`,
        );
      }
      const type = file.type || "application/octet-stream";
      const url = `data:${type};base64,${base64(new Uint8Array(await file.arrayBuffer()))}`;
      return {
        kind: isImageType(type) ? "image" : "file",
        url,
        name: file.name,
        mimeType: type,
        size: file.size,
      };
    },
  };
}

/** Checks attachments on a new or edited comment. Throws `invalid_input`. */
export function validateAttachments(list: unknown): CommentAttachment[] | undefined {
  if (list === undefined || list === null) return undefined;
  if (!Array.isArray(list))
    throw new AnnotateKitError("invalid_input", "attachments must be a list");
  if (list.length > MAX_ATTACHMENTS) {
    throw new AnnotateKitError(
      "invalid_input",
      `At most ${MAX_ATTACHMENTS} attachments per comment`,
    );
  }
  return list.map((a: Partial<CommentAttachment> | null, i) => {
    if (!a || typeof a !== "object") {
      throw new AnnotateKitError("invalid_input", `attachments[${i}] must be an object`);
    }
    if (a.kind !== "image" && a.kind !== "file" && a.kind !== "link") {
      throw new AnnotateKitError("invalid_input", `attachments[${i}].kind is invalid`);
    }
    if (!isSafeAttachmentUrl(a.url)) {
      throw new AnnotateKitError("invalid_input", `attachments[${i}].url is not an allowed URL`);
    }
    return a as CommentAttachment;
  });
}
