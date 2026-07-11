import { describe, expect, it } from "vitest";
import { imageStoragePath } from "./process-image";

describe("imageStoragePath", () => {
  it("is deterministic — same source + url always maps to one shared object", () => {
    const a = imageStoragePath("d0000000-0000-0000-0000-000000000001", "https://cdn.x/1.jpg");
    const b = imageStoragePath("d0000000-0000-0000-0000-000000000001", "https://cdn.x/1.jpg");
    expect(a).toBe(b);
  });

  it("shapes as {sourceProductId}/{12-hex}.webp", () => {
    expect(imageStoragePath("sp-1", "https://cdn.x/photo.jpg?w=800")).toMatch(
      /^sp-1\/[0-9a-f]{12}\.webp$/,
    );
  });

  it("different urls get different objects", () => {
    expect(imageStoragePath("sp-1", "https://cdn.x/1.jpg")).not.toBe(
      imageStoragePath("sp-1", "https://cdn.x/2.jpg"),
    );
  });
});
