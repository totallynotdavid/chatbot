import process from "node:process";

export const DEFAULT_GRAPH_VERSION = "v26.0";
export const DEFAULT_GRAPH_BASE_URL = "https://graph.facebook.com";

const VERSION_PATTERN = /^v\d+\.\d+$/;

export function graphConfig(): { baseUrl: string; version: string } {
  const version =
    process.env.GRAPH_API_VERSION?.trim() || DEFAULT_GRAPH_VERSION;
  if (!VERSION_PATTERN.test(version)) {
    throw new Error(
      `GRAPH_API_VERSION must look like "v26.0", got "${version}"`,
    );
  }

  const raw = process.env.GRAPH_API_BASE_URL?.trim() || DEFAULT_GRAPH_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`GRAPH_API_BASE_URL is not a URL: "${raw}"`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`GRAPH_API_BASE_URL must be http(s), got "${raw}"`);
  }

  return { baseUrl: url.origin, version };
}

export function graphUrl(path: string): string {
  const { baseUrl, version } = graphConfig();
  return `${baseUrl}/${version}/${path.replace(/^\/+/, "")}`;
}

export function assertGraphConfig(): void {
  graphConfig();
}
