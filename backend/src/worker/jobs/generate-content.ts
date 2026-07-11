import { GoogleGenAI } from "@google/genai";
import { query, queryOne, notify } from "../../lib/db";
import type { GenerateContentPayload } from "../queues";

/**
 * Rewrites the scraped supplier description into unique, Arabic-first,
 * SEO-ready content. Triggered from the dashboard ("حسّن المحتوى بالذكاء
 * الاصطناعي") or automatically after import.
 *
 * Honest note for the docs: rewriting improves SEO uniqueness — it is NOT a
 * legal guarantee against IP claims on the underlying product content.
 */
export async function handleGenerateContent(payload: GenerateContentPayload) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[content.generate] GEMINI_API_KEY missing — skipping");
    return;
  }

  const listing = await queryOne<{
    id: string;
    store_id: string;
    title_ar: string;
    source_title: string;
    source_description: string | null;
  }>(
    `select l.id, l.store_id, l.title_ar,
            sp.title as source_title, sp.description as source_description
     from listings l
     join source_products sp on sp.id = l.source_product_id
     where l.id = $1`,
    [payload.listingId],
  );
  if (!listing) return;

  const ai = new GoogleGenAI({ apiKey });
  const prompt = `أنت كاتب محتوى تسويقي لمتجر إلكتروني مصري.
أعد كتابة بيانات المنتج التالية بأسلوب جديد تمامًا (ليس نسخًا) وبنبرة مصرية بسيطة تبيع.

المنتج: ${listing.source_title}
الوصف الأصلي: ${listing.source_description ?? "(لا يوجد)"}

أعد JSON فقط بدون أي نص إضافي، بالمفاتيح التالية:
{
  "title_ar": "عنوان عربي جذاب (حتى 70 حرف)",
  "title_en": "English title (up to 70 chars)",
  "description_ar": "وصف عربي مقنع 80-150 كلمة، فقرات قصيرة",
  "description_en": "English description, 80-150 words",
  "seo": {
    "meta_title": "حتى 60 حرف",
    "meta_description": "حتى 155 حرف",
    "keywords": ["3 إلى 6 كلمات مفتاحية"]
  }
}`;

  const res = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });

  const text = (res.text ?? "").replace(/^```json\s*|```\s*$/g, "").trim();
  let content: Record<string, unknown>;
  try {
    content = JSON.parse(text);
  } catch {
    console.error("[content.generate] unparseable model output for", listing.id);
    return;
  }

  await query(
    `update listings set
       title_ar = coalesce(nullif($2, ''), title_ar),
       title_en = coalesce(nullif($3, ''), title_en),
       description_ar = coalesce(nullif($4, ''), description_ar),
       description_en = coalesce(nullif($5, ''), description_en),
       seo = coalesce($6::jsonb, seo),
       ai_generated = true
     where id = $1`,
    [
      listing.id,
      String(content.title_ar ?? ""),
      String(content.title_en ?? ""),
      String(content.description_ar ?? ""),
      String(content.description_en ?? ""),
      JSON.stringify(content.seo ?? {}),
    ],
  );

  await notify(listing.store_id, "import_done", "تم تحسين محتوى المنتج",
    String(content.title_ar ?? listing.title_ar), { listingId: listing.id });
}
