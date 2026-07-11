import { describe, expect, it } from "vitest";
import { checkImportUrl } from "./ssrf";

const bad = (u: string) => {
  const r = checkImportUrl(u);
  expect(r.ok, u).toBe(false);
  return r.ok ? "" : r.code;
};

describe("checkImportUrl (SSRF guard + platform policy)", () => {
  it("accepts normal supplier product URLs", () => {
    expect(checkImportUrl("https://supplier.eg/products/watch-1").ok).toBe(true);
    expect(checkImportUrl("http://shop.example.com/p/1?variant=2").ok).toBe(true);
  });

  it("rejects non-http(s) schemes", () => {
    expect(bad("ftp://supplier.eg/x")).toBe("UNSAFE_URL");
    expect(bad("file:///etc/passwd")).toBe("UNSAFE_URL");
    expect(bad("not a url")).toBe("UNSAFE_URL");
  });

  it("rejects localhost and internal TLDs", () => {
    for (const u of [
      "http://localhost/x",
      "http://api.localhost/x",
      "http://db.local/x",
      "http://vault.internal/x",
    ]) {
      expect(bad(u)).toBe("UNSAFE_URL");
    }
  });

  it("rejects private and link-local IP ranges", () => {
    for (const u of [
      "http://127.0.0.1/x",
      "http://10.1.2.3/x",
      "http://192.168.1.1/x",
      "http://172.16.0.1/x",
      "http://172.31.255.255/x",
      "http://169.254.1.1/x",
      "http://0.0.0.0/x",
      "http://[::1]/x",
    ]) {
      expect(bad(u)).toBe("UNSAFE_URL");
    }
  });

  it("does NOT reject public 172.x outside 16-31", () => {
    expect(checkImportUrl("http://172.32.0.1/x").ok).toBe(true);
  });

  it("rejects Amazon in any marketplace TLD (platform policy)", () => {
    for (const u of [
      "https://www.amazon.com/dp/B0TEST",
      "https://amazon.eg/dp/B0TEST",
      "https://www.amazon.co.uk/dp/B0TEST",
      "https://amzn.to/abc",
    ]) {
      expect(bad(u)).toBe("UNSUPPORTED_URL");
    }
  });

  it("does not false-positive on amazon-like names", () => {
    expect(checkImportUrl("https://myamazonshop.com/p/1").ok).toBe(true);
  });
});
