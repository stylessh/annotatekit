// AnnotateKit's own icon set: plain strokes on a 16px grid with square caps and
// mitered joins, so icons stay sharp and simple at toolbar sizes. Rendered by
// `icon()` with stroke="currentColor"; a node can override fill/stroke.
export type IconNode = [tag: string, attrs: Record<string, string>];

const p = (d: string): IconNode => ["path", { d }];
const circle = (r = 5.75, extra: Record<string, string> = {}): IconNode => [
  "circle",
  { cx: "8", cy: "8", r: String(r), ...extra },
];
const rect = (x: number, y: number, w: number, h: number): IconNode => [
  "rect",
  { x: String(x), y: String(y), width: String(w), height: String(h) },
];
/** Chat bubble with a square tail. */
const bubble = p("M2.5 3H13.5V11H6.5L3.5 13.5V3Z");

export const ICONS = {
  annotate: [p("M3 13V10.5L10.5 3L13 5.5L5.5 13H3Z"), p("M8.75 4.75L11.25 7.25")],
  check: [p("M3 8.5L6.5 12L13 4.5")],
  cursor: [p("M3 3L13 7L8.5 8.5L7 13L3 3Z")],
  area: [
    p("M2.5 5V2.5H5M11 2.5H13.5V5M13.5 11V13.5H11M5 13.5H2.5V11"),
    p("M7.25 2.5H8.75M7.25 13.5H8.75M2.5 7.25V8.75M13.5 7.25V8.75"),
  ],
  text: [p("M3 4.5V2.5H13V4.5"), p("M8 2.5V13.5"), p("M6 13.5H10")],
  key: [
    circle(2.75, { cx: "5", cy: "11" }),
    p("M7 9L13.5 2.5"),
    p("M11 5L13 7"),
    p("M9.25 6.75L10.75 8.25"),
  ],
  close: [p("M3.5 3.5L12.5 12.5M12.5 3.5L3.5 12.5")],
  attach: [
    p(
      "M10.5 5L5.75 9.75A1.5 1.5 0 0 0 7.87 11.87L12.4 7.35A3 3 0 0 0 8.15 3.1L3.6 7.65A4.5 4.5 0 0 0 9.97 14L13.5 10.5",
    ),
  ],
  back: [p("M13.5 8H3"), p("M7 4L3 8L7 12")],
  alert: [p("M8 2L14.5 13.5H1.5L8 2Z"), p("M8 6.5V9.5M8 11.25V11.5")],
  chat: [bubble],
  threads: [bubble],
  list: [p("M2.5 4H13.5M2.5 8H13.5M2.5 12H13.5")],
  phone: [rect(4.5, 1.5, 7, 13), p("M7.25 12H8.75")],
  tablet: [rect(3, 1.5, 10, 13), p("M7.25 12H8.75")],
  laptop: [rect(3, 3, 10, 7.5), p("M1 13H15")],
  desktop: [rect(1.5, 2.5, 13, 9), p("M8 11.5V14M5 14H11")],
  "status-open": [circle(5.75, { "stroke-dasharray": "2.26 2.26", "stroke-linecap": "butt" })],
  "status-progress": [
    circle(),
    ["path", { d: "M8 4.5A3.5 3.5 0 0 1 8 11.5Z", fill: "currentColor", stroke: "none" }],
  ],
  "status-review": [p("M1.5 8Q8 1 14.5 8Q8 15 1.5 8Z"), circle(2)],
  "status-resolved": [circle(), p("M5.25 8.25L7.25 10.25L10.75 6.25")],
  "status-dismissed": [circle(), p("M5.25 8H10.75")],
  reopen: [p("M3.33 6.62A5.5 5.5 0 1 1 3.33 10.38"), p("M3 2.75V6.6H6.85")],
  approve: [p("M1.5 8.5L4.5 11.5L11 4.5"), p("M8 11L8.5 11.5L15 4.5")],
  send: [p("M8 13.5V3"), p("M3.5 7.5L8 3L12.5 7.5")],
  agent: [p("M8 1.5L9.5 6.5L14.5 8L9.5 9.5L8 14.5L6.5 9.5L1.5 8L6.5 6.5L8 1.5Z")],
  target: [circle(), p("M8 1V5M8 11V15M1 8H5M11 8H15")],
} satisfies Record<string, IconNode[]>;
