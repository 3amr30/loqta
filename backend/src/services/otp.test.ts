import { describe, expect, it } from "vitest";
import { toEgyptE164 } from "./otp";

describe("toEgyptE164", () => {
  it("converts a local Egyptian mobile to E.164", () => {
    expect(toEgyptE164("01012345678")).toBe("+201012345678");
    expect(toEgyptE164("01112223344")).toBe("+201112223344");
  });
  it("only strips a single leading zero", () => {
    expect(toEgyptE164("01555555555")).toBe("+201555555555");
  });
});
