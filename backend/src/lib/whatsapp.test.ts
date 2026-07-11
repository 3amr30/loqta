import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeWaPhone, validateTwilioSignature } from "./whatsapp";

/** Reference signer per Twilio's published algorithm (url + key-sorted key+value pairs). */
const sign = (token: string, url: string, params: Record<string, string>) =>
  createHmac("sha1", token)
    .update(
      url +
        Object.keys(params)
          .sort()
          .map((k) => k + params[k])
          .join(""),
      "utf-8",
    )
    .digest("base64");

describe("validateTwilioSignature", () => {
  const token = "test_auth_token";
  const url = "https://api.loqta.shop/v1/webhooks/whatsapp";
  const params = { From: "whatsapp:+201012345678", Body: "نعم", MessageSid: "SM123" };

  it("accepts a correctly signed request (Arabic body included)", () => {
    expect(validateTwilioSignature(token, url, params, sign(token, url, params))).toBe(true);
  });

  it("rejects when any param was tampered after signing", () => {
    const sig = sign(token, url, params);
    expect(validateTwilioSignature(token, url, { ...params, Body: "لا" }, sig)).toBe(false);
  });

  it("rejects an added param", () => {
    const sig = sign(token, url, params);
    expect(
      validateTwilioSignature(token, url, { ...params, Injected: "x" }, sig),
    ).toBe(false);
  });

  it("rejects a signature made for a different URL", () => {
    const sig = sign(token, "https://evil.example/hook", params);
    expect(validateTwilioSignature(token, url, params, sig)).toBe(false);
  });

  it("rejects garbage signatures without throwing", () => {
    expect(validateTwilioSignature(token, url, params, "AAAA")).toBe(false);
    expect(validateTwilioSignature(token, url, params, "")).toBe(false);
  });

  it("is insensitive to param object order (spec sorts by key)", () => {
    const sig = sign(token, url, params);
    const shuffled = { MessageSid: "SM123", Body: "نعم", From: "whatsapp:+201012345678" };
    expect(validateTwilioSignature(token, url, shuffled, sig)).toBe(true);
  });
});

describe("normalizeWaPhone", () => {
  it("strips the whatsapp: prefix", () => {
    expect(normalizeWaPhone("whatsapp:+201012345678")).toBe("+201012345678");
  });
  it("passes plain E.164 through", () => {
    expect(normalizeWaPhone("+201012345678")).toBe("+201012345678");
  });
});
