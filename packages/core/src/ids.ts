export type IdPrefix = "thr" | "ann" | "cmt" | "grp" | (string & {});

/** Generate a prefixed, URL-safe id such as `thr_3f9c…`. */
export function createId(prefix: IdPrefix): string {
  return `${prefix}_${randomHex()}`;
}

function randomHex(): string {
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  let out = "";
  for (let i = 0; i < 32; i++) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}
