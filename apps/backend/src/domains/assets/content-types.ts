/**
 * What an asset is allowed to claim to be.
 *
 * `assets.content_type` starts life as the uploading browser's `File.type`:
 * client-controlled, chosen by whoever picked the file. GET /api/assets/:id
 * used to echo it back verbatim with no disposition, so a tenant user who
 * uploaded an .html or .svg file as a "contract" got it served as text/html
 * from the API's own origin - stored XSS against every session on that origin,
 * their own tenant's and everybody else's.
 *
 * Two rules close it, and each would be enough on its own:
 *
 *  - only a type on the list below is ever stored, so the column holds
 *    something the deployment chose rather than something a client did;
 *  - only a type on the list below is ever served, and every private asset goes
 *    out as an attachment, so a row written before this existed (or by a future
 *    caller that forgets) still cannot be rendered in the browser.
 *
 * `image/svg+xml` is deliberately absent: an SVG is a document that can carry
 * script, so it is not an image as far as this file is concerned.
 */

import type { AssetKind } from "@totem/types";

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

const ALLOWED_CONTENT_TYPES: Record<AssetKind, readonly string[]> = {
  contract: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
  recording: [
    "audio/mpeg",
    "audio/mp4",
    "audio/aac",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
  ],
  // Catalog images are re-encoded by sharp before they are stored, so the type
  // is the one this codebase produced, not one a client declared.
  catalog_image: ["image/jpeg"],
};

/** Strip the parameters a browser may append ("audio/webm;codecs=opus"). */
function baseType(declared: string): string {
  const [type = ""] = declared.split(";");
  return type.trim().toLowerCase();
}

/**
 * The value to record on the asset row. Anything unrecognised is stored as
 * null: the upload itself is kept - it is the customer's signed contract, and
 * refusing it over a header the client wrote would lose real work - but nothing
 * downstream gets to believe a type nobody vouched for.
 */
export function storableContentType(
  kind: AssetKind,
  declared: string | null | undefined,
): string | null {
  if (!declared) return null;
  const base = baseType(declared);
  return ALLOWED_CONTENT_TYPES[kind].includes(base) ? base : null;
}

/** The `Content-Type` to answer with. Never the raw column. */
export function servableContentType(asset: {
  kind: AssetKind;
  content_type: string | null;
}): string {
  return (
    storableContentType(asset.kind, asset.content_type) ?? DEFAULT_CONTENT_TYPE
  );
}
