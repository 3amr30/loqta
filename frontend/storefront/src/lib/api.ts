const API_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, init);
  if (!res.ok) {
    let code = "INTERNAL";
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { code: string; message: string } };
      if (body.error) ({ code, message } = body.error);
    } catch {
      /* non-JSON */
    }
    throw new ApiError(code, res.status, message);
  }
  return (await res.json()) as T;
}

export interface PublicStore {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  currency: string;
  shipping_fee: number;
  low_stock_threshold: number;
  whatsapp_phone: string | null;
}

export interface PublicListing {
  id: string;
  slug: string;
  title_ar: string;
  title_en?: string | null;
  images: string[];
  retail_price: number;
  currency: string;
  stock_status: string;
  stock_qty?: number | null;
  description_ar?: string | null;
}

export interface PublicReview {
  rating: number;
  comment: string | null;
  buyer_name: string;
  created_at: string;
}

export interface ReviewsBlock {
  avg: number | null;
  count: number;
  latest: PublicReview[];
}

export interface PublicVariant {
  id: string;
  retail_price: number;
  title: string;
  options: Record<string, string>;
  image_url: string | null;
  stock_status: string;
}
