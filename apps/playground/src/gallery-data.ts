import type {
  Actor,
  Annotation,
  Comment,
  CommentAttachment,
  Thread,
  ThreadDetail,
  ThreadStatus,
} from "@annotatekit/core";

/** A fixed clock, so relative times in the gallery never change. */
export const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

export const people = {
  alan: { kind: "human", id: "usr_alan", name: "Alan Styles" },
  maya: { kind: "human", id: "usr_maya", name: "Maya Chen" },
  jo: { kind: "human", id: "usr_jo", name: "Jo Park" },
  claude: { kind: "agent", id: "agt_claude", name: "Claude", onBehalfOf: "usr_alan" },
} satisfies Record<string, Actor>;

/** A fake screenshot as a base64 SVG data URL. */
function screenshot(hue: number, label: string, w = 640, h = 400): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="hsl(${hue} 80% 62%)"/><stop offset="1" stop-color="hsl(${hue + 40} 80% 52%)"/>
  </linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#g)"/>
  <rect x="40" y="40" width="${w - 80}" height="36" rx="18" fill="rgba(255,255,255,.22)"/>
  <rect x="40" y="110" width="${(w - 80) * 0.6}" height="28" rx="8" fill="rgba(255,255,255,.85)"/>
  <rect x="40" y="152" width="${(w - 80) * 0.45}" height="16" rx="8" fill="rgba(255,255,255,.5)"/>
  <rect x="40" y="${h - 96}" width="150" height="48" rx="24" fill="rgba(255,255,255,.95)"/>
  <rect x="206" y="${h - 96}" width="150" height="48" rx="24" fill="rgba(255,255,255,.25)"/>
  <text x="${w - 40}" y="${h - 36}" text-anchor="end" font-family="sans-serif" font-size="20" fill="rgba(255,255,255,.8)">${label}</text>
</svg>`;
  const bytes = new TextEncoder().encode(svg);
  return `data:image/svg+xml;base64,${btoa(String.fromCharCode(...bytes))}`;
}

export const images: CommentAttachment[] = [
  {
    kind: "image",
    url: screenshot(240, "md · 768px"),
    name: "hero-tablet.png",
    mimeType: "image/svg+xml",
    size: 182_311,
  },
  {
    kind: "image",
    url: screenshot(330, "sm · 390px"),
    name: "hero-phone.png",
    mimeType: "image/svg+xml",
    size: 96_004,
  },
  {
    kind: "image",
    url: screenshot(150, "xl · 1280px"),
    name: "hero-desktop.png",
    mimeType: "image/svg+xml",
    size: 241_870,
  },
];
export const files: CommentAttachment[] = [
  {
    kind: "file",
    url: "https://example.com/specs/hero-spacing.pdf",
    name: "hero-spacing.pdf",
    mimeType: "application/pdf",
    size: 1_240_000,
  },
  {
    kind: "file",
    url: "https://example.com/tokens.json",
    name: "tokens.json",
    mimeType: "application/json",
    size: 3_412,
  },
];

let n = 0;
export function comment(
  author: Actor,
  body: string,
  minutesAgo: number,
  extra: Partial<Comment> = {},
): Comment {
  n++;
  return {
    id: `cmt_${n}`,
    threadId: "thr_1",
    author,
    body,
    format: "plain",
    createdAt: ago(minutesAgo),
    updatedAt: ago(minutesAgo),
    ...extra,
  };
}

export const event = (author: Actor, body: string, minutesAgo: number, name: string) =>
  comment(author, body, minutesAgo, { metadata: { system: true, event: name } });

export function thread(
  id: string,
  title: string,
  status: ThreadStatus,
  opts: { by?: Actor; count?: number; minutesAgo?: number } = {},
): Thread {
  return {
    id,
    projectId: "gallery",
    annotationId: `ann_${id}`,
    page: { url: "https://acme.dev/pricing", origin: "https://acme.dev", pathname: "/pricing" },
    status,
    title,
    createdBy: opts.by ?? people.maya,
    createdAt: ago(opts.minutesAgo ?? 300),
    updatedAt: ago(opts.minutesAgo ?? 300),
    commentCount: opts.count ?? 1,
    lastCommentAt: ago((opts.minutesAgo ?? 300) / 3),
  };
}

export function annotation(threadId: string, selector: string): Annotation {
  return {
    id: `ann_${threadId}`,
    projectId: "gallery",
    threadId,
    kind: "pin",
    anchor: {
      selector,
      tagName: "button",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      scroll: { x: 0, y: 0 },
    },
    position: { x: 0.5, y: 0.5 },
    context: {
      viewport: { width: 768, height: 1024, devicePixelRatio: 2 },
      breakpoint: { name: "md", minWidth: 768, maxWidth: 1024 },
    },
    createdBy: people.maya,
    createdAt: ago(300),
    updatedAt: ago(300),
  };
}

/** A full conversation: question, replies, an agent's fix, status events and attachments. */
export function conversation(status: ThreadStatus = "pending_review"): ThreadDetail {
  return {
    thread: thread("thr_1", "Hero CTA wraps on tablet", status, { count: 6 }),
    annotation: annotation("thr_1", 'section.hero [data-testid="cta"]'),
    comments: [
      comment(
        people.maya,
        "The “Get started” button wraps onto two lines at md. Can we keep it on one line and tighten the gap?",
        300,
        { attachments: [images[0] as CommentAttachment] },
      ),
      comment(people.alan, "Good catch. Phone looks fine, only tablet breaks.", 240, {
        attachments: [images[1] as CommentAttachment, images[2] as CommentAttachment],
      }),
      event(people.claude, "Claude started working on this", 90, "status"),
      comment(
        people.claude,
        "Set `white-space: nowrap` on the CTA and reduced the hero gap from 24px to 16px at md. Spacing spec attached.",
        42,
        { attachments: [files[0] as CommentAttachment] },
      ),
      event(people.claude, "Claude proposed a fix for review", 41, "status"),
      comment(people.maya, "Checking on my iPad now.", 3),
    ],
  };
}

export const listItems = (): { thread: Thread; label: string }[] => [
  {
    thread: thread("thr_1", "Hero CTA wraps on tablet", "pending_review", {
      count: 6,
      minutesAgo: 300,
    }),
    label: "1",
  },
  {
    thread: thread("thr_2", "Pricing cards misaligned", "open", {
      by: people.alan,
      count: 1,
      minutesAgo: 40,
    }),
    label: "2",
  },
  {
    thread: thread("thr_3", "Use the brand blue for links", "in_progress", {
      by: people.jo,
      count: 3,
      minutesAgo: 1400,
    }),
    label: "3",
  },
  {
    thread: thread("thr_4", "Typo in the Scale plan", "resolved", { count: 2, minutesAgo: 5000 }),
    label: "4",
  },
];
