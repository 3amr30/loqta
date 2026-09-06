import type { FastifyInstance } from "fastify";
import type { Config } from "../../config";
import { notify, queryOne } from "../../lib/db";
import { logWaMessage, normalizeWaPhone, validateTwilioSignature } from "../../lib/whatsapp";
import { decideConfirmAction, parseConfirmReply } from "../../services/confirm";

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

      // ① Order-confirmation branch. Find this phone's order still awaiting a
      // reply (tenant-scoped to the attributed store when known). The reply is
      // untrusted text — we never take an order id from it, only match by the
      // phone Twilio verified. The guarded UPDATE makes duplicate delivery a
      // no-op at the DB level.
      const order = await queryOne<{ id: string; store_id: string; order_number: string; confirmation_status: string | null }>(
        `select id, store_id, order_number, whatsapp_confirmation_status as confirmation_status
         from orders
         where customer_phone = $1 and whatsapp_confirmation_status = 'sent'
           ${ctx?.store_id ? "and store_id = $2" : ""}
         order by created_at desc limit 1`,
        ctx?.store_id ? [phone, ctx.store_id] : [phone],
      );

      if (order) {
        const action = decideConfirmAction(parseConfirmReply(body), order.confirmation_status);
        if (action.kind === "confirm") {
          const moved = await queryOne<{ id: string }>(
            `update orders set status = 'confirmed',
                    whatsapp_confirmation_status = 'confirmed', whatsapp_confirmed_at = now()
             where id = $1 and status = 'pending' and whatsapp_confirmation_status = 'sent'
             returning id`,
            [order.id],
          );
          if (moved) {
            await notify(order.store_id, "new_order", "تم تأكيد الطلب ✅",
              `${order.order_number} — العميل أكد الطلب على واتساب.`, { orderNumber: order.order_number });
          }
        } else if (action.kind === "decline") {
          const moved = await queryOne<{ id: string }>(
            `update orders set whatsapp_confirmation_status = 'declined'
             where id = $1 and whatsapp_confirmation_status = 'sent'
             returning id`,
            [order.id],
          );
          if (moved) {
            // Order stays pending on purpose — the merchant decides, not a reply.
            await notify(order.store_id, "order_flagged", "العميل رفض تأكيد الطلب",
              `${order.order_number} — محتاج مراجعة يدوية.`, { orderNumber: order.order_number });
          }
        }
      }

      // ② P10: AI chatbot branch (settings.ai_chatbot_enabled).

      return reply.header("content-type", "text/xml").send("<Response/>");
    },
  );
}
