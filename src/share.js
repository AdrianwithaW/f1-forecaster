// Encode/decode a scenario into a compact, URL-safe string so it can be shared
// via a link. Only the *scenario* travels in the URL (season, points config,
// predictions) — the live standings are re-fetched from the API on the other
// end, which keeps links short and always up to date.
//
// Format: a 2-char prefix tags the encoding, followed by base64url data.
//   "g~" → gzip-compressed JSON (when CompressionStream is available)
//   "j~" → plain JSON (fallback for older browsers)

const GZIP = "g~";
const PLAIN = "j~";

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function gzip(str) {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(new TextEncoder().encode(str));
  writer.close();
  const buf = await new Response(cs.readable).arrayBuffer();
  return new Uint8Array(buf);
}

async function gunzip(bytes) {
  const ds = new DecompressionStream("gzip");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const buf = await new Response(ds.readable).arrayBuffer();
  return new TextDecoder().decode(buf);
}

export async function encodeScenario(obj) {
  const json = JSON.stringify(obj);
  if (typeof CompressionStream !== "undefined") {
    try {
      return GZIP + bytesToB64url(await gzip(json));
    } catch {
      /* fall through to plain */
    }
  }
  return PLAIN + bytesToB64url(new TextEncoder().encode(json));
}

export async function decodeScenario(code) {
  if (!code) throw new Error("Empty scenario code.");
  if (code.startsWith(GZIP)) {
    return JSON.parse(await gunzip(b64urlToBytes(code.slice(2))));
  }
  const payload = code.startsWith(PLAIN) ? code.slice(2) : code;
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
}

// Build a shareable absolute URL for the current page carrying the scenario.
export async function buildShareUrl(obj) {
  const code = await encodeScenario(obj);
  const base = `${location.origin}${location.pathname}`;
  return `${base}#s=${code}`;
}

// Read a scenario code from the current URL hash, if present.
export function readScenarioFromHash() {
  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash;
  const params = new URLSearchParams(hash);
  return params.get("s");
}

// Remove the scenario from the URL once it's been imported, so later edits
// (saved to localStorage) aren't overwritten on the next refresh.
export function clearScenarioHash() {
  history.replaceState(null, "", `${location.origin}${location.pathname}`);
}
