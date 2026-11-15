import { INSTRUMENT_SANS_WOFF2 } from "./font-data.js";

/**
 * The overlay's font is registered under its own family name, so it can't
 * change how the host page renders, even if the page also uses Instrument Sans.
 */
export const OVERLAY_FONT_FAMILY = "AnnotateKit Instrument Sans";

function decode(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Registers the bundled Instrument Sans with the document. `@font-face` rules
 * inside a shadow root are ignored by browsers, so the overlay adds the face
 * through the FontFace API instead; shadow trees then use it by family name.
 * Loading from bytes, not a URL, keeps it working under strict CSPs.
 */
export function loadOverlayFont(doc: Document): void {
  const fonts = doc.fonts as FontFaceSet | undefined;
  const FontFaceCtor = doc.defaultView?.FontFace;
  if (!fonts || !FontFaceCtor) return;
  for (const face of fonts) if (face.family.replace(/"/g, "") === OVERLAY_FONT_FAMILY) return;
  try {
    const face = new FontFaceCtor(OVERLAY_FONT_FAMILY, decode(INSTRUMENT_SANS_WOFF2), {
      weight: "400 700",
      style: "normal",
      display: "swap",
    });
    fonts.add(face);
    face.load().catch(() => {});
  } catch {
    // Falls back to the system font stack.
  }
}
