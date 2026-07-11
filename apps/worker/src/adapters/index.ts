import type { SourceAdapter } from "@loqta/core";
import { aliexpressAdapter } from "./aliexpress";
import { genericAdapter } from "./generic";

/**
 * Ordered registry — first adapter whose canHandle() matches wins.
 * genericAdapter matches any http(s) URL, so it must stay LAST.
 */
const adapters: SourceAdapter[] = [aliexpressAdapter, genericAdapter];

export function resolveAdapter(url: string): SourceAdapter {
  const adapter = adapters.find((a) => a.canHandle(url));
  if (!adapter) throw new Error(`No adapter can handle: ${url}`);
  return adapter;
}
