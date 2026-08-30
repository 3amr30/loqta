import { describe, expect, it } from "vitest";
import { OTP_TOKEN_TTL_SEC, signOtpToken, verifyOtpToken } from "./otp-token";

const SECRET = "test-otp-secret";
const STORE = "b0000000-0000-4000-8000-000000000001";
const PHONE = "01012345678";

describe("otp token", () => {
  it("verifies a fresh token for the same store+phone", () => {
    const t = signOtpToken(SECRET, STORE, PHONE);
    expect(verifyOtpToken(SECRET, t, STORE, PHONE)).toBe(true);
  });

  it("rejects a token for a different phone or store", () => {
    const t = signOtpToken(SECRET, STORE, PHONE);
    expect(verifyOtpToken(SECRET, t, STORE, "01099999999")).toBe(false);
    expect(verifyOtpToken(SECRET, t, "other-store", PHONE)).toBe(false);
  });

  it("rejects a token signed with a different secret (tamper)", () => {
    const t = signOtpToken(SECRET, STORE, PHONE);
    expect(verifyOtpToken("wrong-secret", t, STORE, PHONE)).toBe(false);
  });

  it("rejects an expired token", () => {
    const now = Date.now();
    const t = signOtpToken(SECRET, STORE, PHONE, { ttlSec: 60, now });
    // 61s later
    expect(verifyOtpToken(SECRET, t, STORE, PHONE, now + 61_000)).toBe(false);
    // still valid within the window
    expect(verifyOtpToken(SECRET, t, STORE, PHONE, now + 59_000)).toBe(true);
  });

  it("rejects malformed tokens without throwing", () => {
    expect(verifyOtpToken(SECRET, "garbage", STORE, PHONE)).toBe(false);
    expect(verifyOtpToken(SECRET, "", STORE, PHONE)).toBe(false);
    expect(verifyOtpToken(SECRET, ".", STORE, PHONE)).toBe(false);
    expect(verifyOtpToken(SECRET, "a.b", STORE, PHONE)).toBe(false);
  });

  it("default TTL is 15 minutes", () => {
    expect(OTP_TOKEN_TTL_SEC).toBe(900);
  });
});
