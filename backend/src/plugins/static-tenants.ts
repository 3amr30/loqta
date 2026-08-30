import { createReadStream, existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config";
import { queryOne } from "../lib/db";
import { injectPixels, injectStorefrontMeta, type ListingMeta, type StoreMeta } from "../seo/inject";

/**
 * Multi-tenant SPA serving:
 *   app.{ROOT_DOMAIN} (or localhost)  -> dashboard dist
 *   {slug}.{ROOT_DOMAIN}             -> storefront dist, HTML responses get
 *                                       per-URL OG/JSON-LD injection
 * /v1/* and /healthz are API — handled before this plugin ever sees them.
 * If a dist folder is missing (dev: Vite serves the SPAs) the tenant is
 * simply disabled and the API keeps working.
 */

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".txt": "text/plain",
};

interface TenantDists {
  dashboardDist: string;
  storefrontDist: string;
}

interface CacheEntry {
  html: string;
  exp: number;
}

export function registerStaticTenants(app: FastifyInstance, config: Config, dists: TenantDists) {
  const dashboardIndex = join(dists.dashboardDist, "index.html");
  const storefrontIndex = join(dists.storefrontDist, "index.html");
  const hasDashboard = existsSync(dashboardIndex);
  const hasStorefront = existsSync(storefrontIndex);
  if (!hasDashboard || !hasStorefront) {
    app.log.warn(
      { hasDashboard, hasStorefront },
      "static-tenants: dist folder(s) missing - SPA serving disabled for those tenants (dev mode?)",
    );
  }
  const storefrontHtml = hasStorefront ? readFileSync(storefrontIndex, "utf8") : "";
  const htmlCache = new Map<string, CacheEntry>();

  const tenantOf = (req: FastifyRequest): { kind: "dashboard" | "storefront"; slug?: string } => {
    const host = String(req.headers.host ?? "").split(":")[0]!.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === config.ROOT_DOMAIN || host === `www.${config.ROOT_DOMAIN}`) {
      return { kind: "dashboard" };
    }
    if (host === `app.${config.ROOT_DOMAIN}` || host.startsWith("app.")) {
      return { kind: "dashboard" };
    }
    if (host.endsWith(`.${config.ROOT_DOMAIN}`)) {
      return { kind: "storefront", slug: host.slice(0, -(config.ROOT_DOMAIN.length + 1)) };
    }
    // Unknown host (e.g. the Railway preview domain) -> dashboard.
    return { kind: "dashboard" };
  };

  const serveAsset = (root: string, urlPath: string, reply: FastifyReply): boolean => {
    const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, "");
    if (rel.includes("..")) return false;
    const file = join(root, rel);
    if (!file.startsWith(root) || !existsSync(file)) return false;
    const type = MIME[extname(file).toLowerCase()] ?? "application/octet-stream";
    // Vite emits content-hashed filenames under /assets - safe to cache hard.
    const cache = urlPath.startsWith("/assets/")
      ? "public, max-age=31536000, immutable"
      : "public, max-age=300";
    void reply.header("content-type", type).header("cache-control", cache).send(createReadStream(file));
    return true;
  };

  async function storefrontHtmlFor(slug: string, urlPath: string): Promise<string | null> {
    const key = `${slug}${urlPath}`;
    const hit = htmlCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.html;

    const store = await queryOne<
      StoreMeta & { id: string; fb_pixel_id: string | null; tiktok_pixel_id: string | null }
    >(
      `select s.id, s.name, s.slug, s.logo_url, s.currency,
              s.settings -> 'policies' as policies,
              s.settings ->> 'fb_pixel_id' as fb_pixel_id,
              s.settings ->> 'tiktok_pixel_id' as tiktok_pixel_id
       from stores s where s.slug = $1`,
      [slug],
    );
    if (!store) return null;

    let listing: ListingMeta | undefined;
    const m = /^\/p\/([^/]+)$/.exec(urlPath);
    if (m) {
      const row = await queryOne<{
        id: string;
        title_ar: string;
        description_ar: string | null;
        images: string[];
        retail_price: number;
        currency: string;
        stock_status: string;
      }>(
        `select id, title_ar, description_ar, images, retail_price::float8 as retail_price,
                currency, stock_status
         from storefront_listings where store_id = $1 and slug = $2`,
        [store.id, decodeURIComponent(m[1]!)],
      );
      if (row) {
        // aggregateRating in the JSON-LD when approved reviews exist (rich unfurls).
        const agg = await queryOne<{ avg: number | null; count: string }>(
          `select avg(rating)::float8 as avg, count(*) as count
           from product_reviews where listing_id = $1 and status = 'approved'`,
          [row.id],
        );
        const count = Number(agg?.count ?? 0);
        listing = {
          title: row.title_ar,
          description: row.description_ar,
          image: Array.isArray(row.images) ? (row.images[0] ?? null) : null,
          price: row.retail_price,
          currency: row.currency,
          available: row.stock_status === "active",
          url: `https://${slug}.${config.ROOT_DOMAIN}${urlPath}`,
          rating: count > 0 && agg?.avg != null ? { value: agg.avg, count } : null,
        };
      }
    }

    let html = injectStorefrontMeta(storefrontHtml, store, listing);
    // Ad pixels (re-validated inside injectPixels — never trust raw settings).
    html = injectPixels(html, {
      fbPixelId: store.fb_pixel_id,
      tiktokPixelId: store.tiktok_pixel_id,
    });
    htmlCache.set(key, { html, exp: Date.now() + 60_000 });
    if (htmlCache.size > 200) {
      const first = htmlCache.keys().next().value;
      if (first) htmlCache.delete(first);
    }
    return html;
  }

  // Everything that is not an API route lands here.
  app.setNotFoundHandler(async (req, reply) => {
    const urlPath = req.url.split("?")[0]!;
    if (urlPath.startsWith("/v1/") || urlPath === "/healthz" || req.method !== "GET") {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Route ${req.method} ${req.url} not found` },
      });
    }

    const tenant = tenantOf(req);
    if (tenant.kind === "dashboard") {
      if (!hasDashboard) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: "Dashboard build not deployed" },
        });
      }
      if (serveAsset(dists.dashboardDist, urlPath, reply)) return;
      return reply
        .header("content-type", "text/html; charset=utf-8")
        .header("cache-control", "no-cache")
        .send(readFileSync(dashboardIndex, "utf8"));
    }

    if (!hasStorefront) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Storefront build not deployed" },
      });
    }
    if (serveAsset(dists.storefrontDist, urlPath, reply)) return;
    const html = await storefrontHtmlFor(tenant.slug!, urlPath);
    if (html === null) {
      return reply.status(404).send({
        error: { code: "STORE_NOT_FOUND", message: "Store not found" },
      });
    }
    return reply
      .header("content-type", "text/html; charset=utf-8")
      .header("cache-control", "no-cache")
      .send(html);
  });
}
