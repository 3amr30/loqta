import { describe, expect, it } from "vitest";
import { evaluateCheckoutGate } from "./checkout-gate";
import { EMPTY_HISTORY } from "./trust";

const proven = { total: 3, confirmed: 3, cancelled: 0, returned: 0 };
const risky = { total: 4, confirmed: 2, cancelled: 2, returned: 0 };

describe("evaluateCheckoutGate", () => {
  it("blocks over the cancellation threshold regardless of OTP", () => {
    expect(
      evaluateCheckoutGate({ otpEnabled: true, blockThreshold: 2, history: risky, hasValidOtpToken: true }),
    ).toEqual({ action: "blocked" });
  });

  it("blocking is off when threshold is unset", () => {
    expect(
      evaluateCheckoutGate({ otpEnabled: false, blockThreshold: null, history: risky, hasValidOtpToken: false }),
    ).toEqual({ action: "proceed" });
  });

  it("requires OTP for a first-time phone when otp is enabled and no token", () => {
    expect(
      evaluateCheckoutGate({ otpEnabled: true, blockThreshold: null, history: EMPTY_HISTORY, hasValidOtpToken: false }),
    ).toEqual({ action: "otp_required" });
  });

  it("proceeds once a valid OTP token is present", () => {
    expect(
      evaluateCheckoutGate({ otpEnabled: true, blockThreshold: null, history: EMPTY_HISTORY, hasValidOtpToken: true }),
    ).toEqual({ action: "proceed" });
  });

  it("skips OTP for a proven buyer even without a token", () => {
    expect(
      evaluateCheckoutGate({ otpEnabled: true, blockThreshold: null, history: proven, hasValidOtpToken: false }),
    ).toEqual({ action: "proceed" });
  });

  it("never requires OTP when the store toggle is off", () => {
    expect(
      evaluateCheckoutGate({ otpEnabled: false, blockThreshold: null, history: EMPTY_HISTORY, hasValidOtpToken: false }),
    ).toEqual({ action: "proceed" });
  });

  it("block takes precedence over otp for a risky phone under threshold", () => {
    // cancelled 2, threshold 5 => not blocked, but unproven+otp => otp_required
    expect(
      evaluateCheckoutGate({ otpEnabled: true, blockThreshold: 5, history: risky, hasValidOtpToken: false }),
    ).toEqual({ action: "otp_required" });
  });
});
