import type { FastifyInstance } from "fastify";
import type { Config } from "../../config";
import { queryOne } from "../../lib/db";
import { logWaMessage, normalizeWaPhone, validateTwilioSignature } from "../../lib/whatsapp";

/**
 * Inbound WhatsApp (Twilio posts application/x-www-form-urlencoded).
 * Signature validation is NOT optional — an unverified webhook would be a
 * spoofable order-confirmation endpoint once P8 lands.
 *
 * Router priority (PLAN-GROWTH §1.1):
 *   ① pending order confirmation for this phone  -> P8 plugs in here
 *   ② store-resolvable AI chatbot                -> P10 plugs in here
 *   ③ otherwise: log + no-op                     (P6 baseline)
 */
export function webhookRoutes(app: FastifyInstance, config: Pick<Config, "PUBLIC_API_URL">) {
  app.post(
    "/v1/webhooks/whatsapp",
    { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const authToken = process.env.TWILIO_AUTH_TOKEN;
      if (!authToken || !config.PUBLIC_API_URL) {
        return reply
          .status(503)
          .send({ error: { code: "NOT_CONFIGURED", message: "WhatsApp is not configured" } });
      }

      const params = (req.body ?? {}) as Record<string, string>;
      const signature = req.headers["x-twilio-signature"];
      const url = `${config.PUBLIC_API_URL.replace(/\/$/, "")}/v1/webhooks/whatsapp`;
      if (
        typeof signature !== "string" ||
        !validateTwilioSignature(authToken, url, params, signature)
      ) {
        return reply
          .status(403)
          .send({ error: { code: "INVALID_SIGNATURE", message: "Signature validation failed" } });
      }

      const phone = normalizeWaPhone(params.From ?? "");
      const body = (params.Body ?? "").trim();

      // Store attribution: the store that last messaged this phone.
      const ctx = await queryOne<{ store_id: string | null }>(
        `select store_id from whatsapp_messages
         where phone = $1 and direction = 'out' and store_id is not null
         order by created_at desc limit 1`,
        [phone],
      );

      await logWaMessage({
        storeId: ctx?.store_id ?? null,
        direction: "in",
        phone,
        body,
        twilioSid: params.MessageSid ?? null,
      });

      // P8: order-confirmation branch (نعم/لا on a whatsapp_confirmation_status='sent' order).
      // P10: AI chatbot branch (settings.ai_chatbot_enabled).

      return reply.header("content-type", "text/xml").send("<Response/>");
    },
  );
}
