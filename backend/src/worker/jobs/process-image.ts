import sharp from "sharp";
import type { ProcessImagePayload } from "../queues";

/**
 * Image pipeline (Phase 3 stub, shape is final):
 *   download supplier image -> resize 1200px -> webp q80 -> upload to
 *   Supabase Storage `product-images/{listingId}/...` -> swap URL on listing.
 *
 * Background removal: run rembg / @imgly/background-removal HERE on the
 * worker, never in the merchant's browser. Watermark removal is deliberately
 * NOT a feature (IP risk) — crop + merchant logo overlay only.
 */
export async function handleProcessImage(payload: ProcessImagePayload) {
  const res = await fetch(payload.imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`image fetch failed ${res.status}: ${payload.imageUrl}`);

  const input = Buffer.from(await res.arrayBuffer());
  const output = await sharp(input)
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  console.log(
    `[image.process] listing=${payload.listingId} ` +
      `${(input.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB webp`,
  );
  // TODO(Phase 3): upload `output` to Supabase Storage and update listings.images.
}
