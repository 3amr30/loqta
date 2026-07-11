import { describe, expect, it } from "vitest";
import { CreateStoreSchema, UpdateStoreSchema } from "./stores";

describe("CreateStoreSchema (slug mirrors the DB check constraint)", () => {
  it("accepts a valid store", () => {
    const out = CreateStoreSchema.parse({ name: "متجري", slug: "my-store-1" });
    expect(out.slug).toBe("my-store-1");
  });

  it("lowercases the slug", () => {
    expect(CreateStoreSchema.parse({ name: "x", slug: "My-Store" }).slug).toBe("my-store");
  });

  it("rejects slugs that the DB would reject", () => {
    for (const slug of ["a", "ab", "-abc", "abc-", "ab_cd", "متجر", "a".repeat(41)]) {
      expect(() => CreateStoreSchema.parse({ name: "x", slug }), slug).toThrow();
    }
  });

  it("accepts the 40-char boundary and rejects 41", () => {
    expect(() => CreateStoreSchema.parse({ name: "x", slug: "a".repeat(40) })).not.toThrow();
    expect(() => CreateStoreSchema.parse({ name: "x", slug: "a".repeat(41) })).toThrow();
  });

  it("rejects unknown fields (strict)", () => {
    expect(() =>
      CreateStoreSchema.parse({ name: "x", slug: "abc", role: "admin" }),
    ).toThrow();
  });
});

describe("UpdateStoreSchema", () => {
  it("accepts sync_policy enum values and shipping_fee >= 0", () => {
    const out = UpdateStoreSchema.parse({
      sync_policy: "auto_apply",
      settings: { shipping_fee: 45 },
    });
    expect(out.sync_policy).toBe("auto_apply");
    expect(out.settings?.shipping_fee).toBe(45);
  });

  it("rejects negative shipping_fee", () => {
    expect(() => UpdateStoreSchema.parse({ settings: { shipping_fee: -1 } })).toThrow();
  });

  it("rejects unknown sync policies", () => {
    expect(() => UpdateStoreSchema.parse({ sync_policy: "yolo" })).toThrow();
  });

  it("allows clearing the logo with null", () => {
    expect(UpdateStoreSchema.parse({ logo_url: null }).logo_url).toBeNull();
  });
});
