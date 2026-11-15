import { describe, expect, it } from "vitest";
import {
  createAnnotateKitService,
  createDataUrlAttachmentAdapter,
  createMemoryStorage,
  isSafeAttachmentUrl,
  pageContextFromUrl,
} from "../src/index.js";
import { alice } from "./fixtures.js";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const file = (name: string, type: string, bytes = PNG) => ({
  name,
  type,
  size: bytes.length,
  arrayBuffer: async () => bytes.buffer.slice(0) as ArrayBuffer,
});

async function thread() {
  const service = createAnnotateKitService({ storage: createMemoryStorage() });
  const detail = await service.createThread(alice, {
    projectId: "shop",
    page: pageContextFromUrl("https://shop.example.com/"),
    annotation: {
      kind: "element",
      anchor: {
        selector: "h1",
        tagName: "h1",
        rect: { x: 0, y: 0, width: 1, height: 1 },
        scroll: { x: 0, y: 0 },
      },
      context: { viewport: { width: 1280, height: 800, devicePixelRatio: 1 } },
    },
    comment: { body: "Hi" },
  });
  return { service, id: detail.thread.id };
}

describe("attachments", () => {
  it("inlines files as data URLs and tells images from files", async () => {
    const adapter = createDataUrlAttachmentAdapter();
    const image = await adapter.upload(file("shot.png", "image/png"), { projectId: "p" });
    expect(image).toMatchObject({
      kind: "image",
      name: "shot.png",
      mimeType: "image/png",
      size: 4,
    });
    expect(image.url).toBe("data:image/png;base64,iVBORw==");
    const doc = await adapter.upload(file("notes.pdf", "application/pdf"), { projectId: "p" });
    expect(doc.kind).toBe("file");
  });

  it("rejects files over the size limit", async () => {
    const adapter = createDataUrlAttachmentAdapter({ maxBytes: 2 });
    await expect(
      adapter.upload(file("big.png", "image/png"), { projectId: "p" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("only accepts safe URLs", () => {
    expect(isSafeAttachmentUrl("https://cdn.example.com/a.png")).toBe(true);
    expect(isSafeAttachmentUrl("data:image/png;base64,iVBORw==")).toBe(true);
    expect(isSafeAttachmentUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeAttachmentUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeAttachmentUrl("")).toBe(false);
  });

  it("stores attachments on comments, which may have no text", async () => {
    const { service, id } = await thread();
    const url = "https://cdn.example.com/a.png";
    const comment = await service.addComment(alice, id, {
      body: "",
      attachments: [{ kind: "image", url, name: "a.png" }],
    });
    expect(comment.body).toBe("");
    expect(comment.attachments).toEqual([{ kind: "image", url, name: "a.png" }]);
    await expect(service.addComment(alice, id, { body: "" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(
      service.addComment(alice, id, {
        body: "x",
        attachments: [{ kind: "file", url: "javascript:alert(1)" }],
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});
