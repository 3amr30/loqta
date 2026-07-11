import { createHash } from "node:crypto";
import sharp from "sharp";
import { query, queryOne } from "../../lib/db";
import { getSupabase } from "../../lib/supabase";
import type { ProcessImagePayload } from "../queues";

/**
 * Image pipeline: download supplier image -> resize 1200px -> webp q80 ->
 * upload to Supabase Storage `product-images` -> swap the URL on the listing.
 * Stops hotlinking supplier CDNs (P6; upload was deferred in P5).
 *
 * Background removal: run rembg / @imgly/background-removal HERE on the
 * worker, never in the merchant's browser. Watermark removal is deliberately
 * NOT a feature (IP risk) — crop + merchant logo overlay only.
 */

export const IMAGES_BUCKET = "product-images";

/**
 * Deterministic per-source path — 50 merchants importing the same product
 * share ONE stored copy (upload is skipped when the object already exists).
 */
export function imageStoragePath(sourceProductId: string, imageUrl: string): string {
  const hash = createHash("md5").update(imageUrl).digest("hex").slice(0, 12);
  return `${sourceProductId}/${hash}.webp`;
}

export async function handleProcessImage(payload: ProcessImagePayload) {
  const listing = await queryOne<{
    id: string;
    source_product_id: string;
    images: string[];
  }>(`select id, source_product_id, images from listings where id = $1`, [payload.listingId]);
  if (!listing) return;
  if (!listing.images.includes(payload.imageUrl)) return; // already swapped or removed by the merchant

  const res = await fetch(payload.imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`image fetch failed ${res.status}: ${payload.imageUrl}`);

  const input = Buffer.from(await res.arrayBuffer());
  const output = await sharp(input)
    .resize({ width: 1200, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();

  const path = imageStoragePath(listing.source_product_id, payload.imageUrl);
  const storage = getSupabase().storage.from(IMAGES_BUCKET);
  const { error } = await storage.upload(path, output, {
    contentType: "image/webp",
    upsert: false,
  });
  // "Already exists" = another listing of the same source uploaded it first — fine.
  if (error && !/exist|duplicate/i.test(error.message)) {
    throw new Error(`storage upload failed: ${error.message}`);
  }
  const { data: pub } = storage.getPublicUrl(path);

  // Swap in-place inside the jsonb array (atomic; two image jobs for the
  // same listing must not clobber each other's swaps).
  await query(
    `update listings
     set images = (
       select coalesce(
         jsonb_agg(case when v = to_jsonb($2::text) then to_jsonb($3::text) else v end
                   order by ord),
         '[]'::jsonb)
       from jsonb_array_elements(images) with ordinality as t(v, ord)
     )
     where id = $1`,
    [listing.id, payload.imageUrl, pub.publicUrl],
  );

  console.log(
    `[image.process] listing=${payload.listingId} ` +
      `${(input.length / 1024).toFixed(0)}KB -> ${(output.length / 1024).toFixed(0)}KB ${path}`,
  );
}
