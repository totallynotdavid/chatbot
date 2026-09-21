/**
 * What an asset is allowed to claim to be.
 *
 * For a contract or recording, `assets.content_type` starts as the uploading
 * browser's `File.type`, which the uploader controls. Echoing it back verbatim
 * with no disposition would serve a tenant user's .html or .svg "contract" as
 * text/html from the API's own origin. That is stored XSS against every session
 * on that origin.
 *
 * Two rules close it, and each is enough on its own:
 *
 *  - Only a type on the list below is stored, so the column holds a type the
 *    deployment chose and not one a client declared.
 *  - Only a type on the list below is served, and every private asset goes out
 *    as an attachment. A row written by a caller that skips the first rule
 *    still cannot be rendered in the browser.
 *
 * `image/svg+xml` is absent on purpose. An SVG can carry script, so it is not
 * an image here.
 */

import type { AssetKind } from "@vendeya/types";

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
 * The value to record on the asset row. An unrecognised type is stored as null.
 * The upload itself is kept, because refusing a customer's signed contract over
 * a header the client wrote would lose real work. Nothing downstream gets to
 * believe a type nobody vouched for.
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
