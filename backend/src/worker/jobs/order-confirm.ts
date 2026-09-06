import { notify, query, queryOne } from "../../lib/db";
import { isWhatsAppConfigured, logWaMessage, sendTemplate } from "../../lib/whatsapp";
import { toEgyptE164 } from "../../services/otp";
import type { WhatsappConfirmPayload } from "../queues";

/**
 * Send the order-confirmation WhatsApp template (P8). Enqueued by checkout
 * when the store enabled confirmations and the template SID is set. Sets
 * whatsapp_confirmation_status='sent' only while the order is still pending
 * and unsent (idempotent — a retried job never double-sends).
 */
export async function handleWhatsappConfirm(payload: WhatsappConfirmPayload) {
  const contentSid = process.env.TWILIO_CONTENT_SID_ORDER_CONFIRM;
  if (!contentSid || !isWhatsAppConfigured()) return; // feature off

  const order = await queryOne<{
    id: string;
    store_id: string;
    customer_name: string;
    customer_phone: string;
    order_number: string;
    total: string;
    currency: string;
    store_name: string;
    confirmation_status: string | null;
    status: string;
  }>(
    `select o.id, o.store_id, o.customer_name, o.customer_phone, o.order_number,
            o.total::text as total, o.currency, s.name as store_name,
            o.whatsapp_confirmation_status as confirmation_status, o.status
     from orders o join stores s on s.id = o.store_id
     where o.id = $1`,
    [payload.orderId],
  );
  if (!order) return;
  if (order.status !== "pending" || order.confirmation_status) return; // already handled

  const sent = await sendTemplate(toEgyptE164(order.customer_phone), contentSid, {
    "1": order.customer_name,
    "2": order.order_number,
    "3": order.store_name,
    "4": order.total,
  });
  if (!sent) return;

  // Guard the flip on the same pending+unsent state (race-safe).
  const marked = await queryOne<{ id: string }>(
    `update orders set whatsapp_confirmation_status = 'sent'
     where id = $1 and status = 'pending' and whatsapp_confirmation_status is null
     returning id`,
    [order.id],
  );
  if (marked) {
    await logWaMessage({
      storeId: order.store_id,
      direction: "out",
      phone: order.customer_phone,
      body: `[confirm] ${order.order_number}`,
      contentSid,
      twilioSid: sent.sid,
      orderId: order.id,
    });
  }
}

/**
 * Hourly cron: orders still awaiting a reply past the store's timeout become
 * 'no_response' and are flagged for manual review — never auto-cancelled.
 * Timeout is per-store (settings.confirmation_timeout_hours, default 6).
 */
export const CONFIRM_TIMEOUT_SQL = `
  update orders o set whatsapp_confirmation_status = 'no_response'
  from stores s
  where s.id = o.store_id
    and o.whatsapp_confirmation_status = 'sent'
    and o.status = 'pending'
    and o.created_at < now()
      - (coalesce((s.settings ->> 'confirmation_timeout_hours')::int, 6) || ' hours')::interval
  returning o.id, o.store_id, o.order_number`;

export async function handleConfirmTimeout() {
  const timedOut = await query<{ id: string; store_id: string; order_number: string }>(
    CONFIRM_TIMEOUT_SQL,
  );
  for (const o of timedOut) {
    await notify(o.store_id, "order_flagged", "طلب محتاج مراجعة",
      `${o.order_number} — العميل ما ردش على تأكيد الطلب.`, { orderNumber: o.order_number });
  }
  if (timedOut.length) console.log(`[confirm.timeout] flagged ${timedOut.length} orders`);
}
