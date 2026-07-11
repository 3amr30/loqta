import { queryOne } from "../../lib/db";
import { isEmailConfigured, sendEmail } from "../../lib/email";
import { isWhatsAppConfigured, logWaMessage, sendTemplate } from "../../lib/whatsapp";
import type { NotifyDispatchPayload } from "../queues";

export type NotifyPrefs = Record<string, unknown>;

export interface DispatchDecision {
  email: boolean;
  whatsapp: boolean;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Which channels mirror this in-app notification. The bell row stays the
 * source of truth; email/WhatsApp are copies of it.
 * Prefs live in stores.settings.notify as { email_<type>, whatsapp_<type> }.
 * Defaults: email ON for new_order only (missing an order for hours is the
 * costly case) — everything else, and all of WhatsApp, is strictly opt-in.
 */
export function decideDispatch(type: string, prefs: NotifyPrefs): DispatchDecision {
  const flag = (key: string, dflt: boolean): boolean => {
    const v = prefs[key];
    return typeof v === "boolean" ? v : dflt;
  };
  return {
    email: flag(`email_${type}`, type === "new_order"),
    whatsapp: flag(`whatsapp_${type}`, false),
  };
}

export async function handleNotifyDispatch(payload: NotifyDispatchPayload) {
  const n = await queryOne<{
    id: string;
    store_id: string;
    type: string;
    title: string;
    body: string | null;
    store_name: string;
    whatsapp_phone: string | null;
    prefs: NotifyPrefs | null;
    merchant_email: string | null;
  }>(
    `select n.id, n.store_id, n.type, n.title, n.body,
            s.name as store_name, s.whatsapp_phone,
            s.settings -> 'notify' as prefs,
            u.email as merchant_email
     from notifications n
     join stores s on s.id = n.store_id
     left join auth.users u on u.id = s.merchant_id
     where n.id = $1`,
    [payload.notificationId],
  );
  if (!n) return;

  const d = decideDispatch(n.type, n.prefs ?? {});
  const dashboardUrl = `https://app.${process.env.ROOT_DOMAIN ?? "loqta.shop"}`;

  if (d.email && n.merchant_email && isEmailConfigured()) {
    await sendEmail(
      n.merchant_email,
      `${n.title} — ${n.store_name}`,
      `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.8;color:#1c1917">
         <h2 style="margin:0 0 8px">${escapeHtml(n.title)}</h2>
         <p style="margin:0 0 16px">${escapeHtml(n.body ?? "")}</p>
         <p><a href="${dashboardUrl}" style="color:#d97706;font-weight:bold">افتح لوحة التحكم ←</a></p>
       </div>`,
    );
  }

  const contentSid = process.env.TWILIO_CONTENT_SID_MERCHANT_ALERT;
  if (d.whatsapp && n.whatsapp_phone && contentSid && isWhatsAppConfigured()) {
    const sent = await sendTemplate(n.whatsapp_phone, contentSid, {
      "1": n.title,
      "2": n.body ?? "",
    });
    if (sent) {
      await logWaMessage({
        storeId: n.store_id,
        direction: "out",
        phone: n.whatsapp_phone,
        body: `${n.title} — ${n.body ?? ""}`,
        contentSid,
        twilioSid: sent.sid,
      });
    }
  }
}
