/**
 * OTP via Twilio Verify (P8). Provider-independent boundary: routes call
 * startVerification / checkVerification and never touch Twilio directly.
 * Verify stores + validates the code server-side (pre-approved WhatsApp
 * templates), so there is no code table here and NO code is ever logged.
 * No-ops (false) when unconfigured — the feature flags off by env presence.
 */

const VERIFY_API = "https://verify.twilio.com/v2";

export function isOtpConfigured(): boolean {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_VERIFY_SERVICE_SID,
  );
}

/** Egyptian local mobile (01xxxxxxxxx) -> E.164 (+201xxxxxxxxx) for Verify. */
export function toEgyptE164(localPhone: string): string {
  return "+20" + localPhone.replace(/^0/, "");
}

function basicAuth(): string {
  return (
    "Basic " +
    Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString(
      "base64",
    )
  );
}

/** Start a verification (WhatsApp channel). Returns whether a code was sent. */
export async function startVerification(
  localPhone: string,
  channel: "whatsapp" | "sms" = "whatsapp",
): Promise<{ sent: boolean }> {
  if (!isOtpConfigured()) return { sent: false };
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  const res = await fetch(`${VERIFY_API}/Services/${sid}/Verifications`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: toEgyptE164(localPhone), Channel: channel }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    // Never include a code — Verify start carries none. Status only.
    throw new Error(`verify start failed ${res.status}`);
  }
  return { sent: true };
}

/** Check a submitted code. True only when Verify reports 'approved'. */
export async function checkVerification(localPhone: string, code: string): Promise<boolean> {
  if (!isOtpConfigured()) return false;
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  const res = await fetch(`${VERIFY_API}/Services/${sid}/VerificationCheck`, {
    method: "POST",
    headers: { authorization: basicAuth(), "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ To: toEgyptE164(localPhone), Code: code }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return false; // 404 = expired / not found / wrong code path
  const json = (await res.json()) as { status?: string };
  return json.status === "approved";
}
