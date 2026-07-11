import { NextRequest, NextResponse } from "next/server";

const ROOT = (process.env.ROOT_DOMAIN ?? "loqta.shop").split(":")[0];

/**
 * Multi-tenant routing:
 *   loqta.shop / www.loqta.shop  -> landing + dashboard (as-is)
 *   {slug}.loqta.shop            -> rewrite to /s/{slug}/...
 *   {slug}.localhost:3000        -> same, for local dev
 *   (Phase 5) custom domains     -> lookup stores.custom_domain
 */
export function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase().split(":")[0];
  const { pathname } = req.nextUrl;

  if (host === ROOT || host === `www.${ROOT}` || host === "localhost") {
    return NextResponse.next();
  }

  let slug: string | null = null;
  if (host.endsWith(`.${ROOT}`)) slug = host.slice(0, -(ROOT.length + 1));
  else if (host.endsWith(".localhost")) slug = host.slice(0, -".localhost".length);

  if (slug && slug !== "www" && slug !== "app") {
    const url = req.nextUrl.clone();
    url.pathname = `/s/${slug}${pathname}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets and API routes.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
