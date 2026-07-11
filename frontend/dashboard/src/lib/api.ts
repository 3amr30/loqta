import { supabase } from "./supabase";
import { API_URL } from "./constants";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Envelope-aware fetch wrapper; attaches the Supabase Bearer token. */
export async function api<T = unknown>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!res.ok) {
    let code = "INTERNAL";
    let message = `HTTP ${res.status}`;
    let details: unknown;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string; details?: unknown } };
      if (body.error) ({ code, message, details } = body.error);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(code, res.status, message, details);
  }
  return (await res.json()) as T;
}

/** Authenticated binary fetch - CSV export etc. A plain <a href> would 401. */
export async function apiBlob(path: string): Promise<Blob> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`${API_URL}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError("DOWNLOAD_FAILED", res.status, `HTTP ${res.status}`);
  return res.blob();
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
