import { needsOtp, shouldBlock, type TrustHistory } from "./trust";

/**
 * Pre-checkout gate (P8). Pure decision over the customer's per-store history:
 * block over the cancellation threshold, else require OTP for unproven phones
 * when the store enabled it, else proceed. The route supplies `hasValidOtpToken`
 * (computed with verifyOtpToken) so the whole decision stays testable offline.
 */

export interface CheckoutGateInput {
  otpEnabled: boolean;
  blockThreshold: number | null | undefined;
  history: TrustHistory;
  hasValidOtpToken: boolean;
}

export type GateDecision = { action: "blocked" } | { action: "otp_required" } | { action: "proceed" };

export function evaluateCheckoutGate(g: CheckoutGateInput): GateDecision {
  if (shouldBlock(g.history, g.blockThreshold)) return { action: "blocked" };
  if (g.otpEnabled && needsOtp(g.history) && !g.hasValidOtpToken) return { action: "otp_required" };
  return { action: "proceed" };
}
