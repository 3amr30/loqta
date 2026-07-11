# WhatsApp templates — submission runbook (P6 day-one task)

Meta must approve every template before it can be sent outside the 24-hour
customer-service window. Approval takes hours to days (plus WhatsApp Business
Account / business verification on first setup), so this runs at the START of
the growth phase — features stay flag-gated until the Content SIDs land in
`backend/.env`.

**Status:** Twilio credentials are not in `backend/.env` yet, so submission is
a user-side task. Run the three curls below with your Twilio account SID/auth
token (the San3a account), then request WhatsApp approval for each.

## 0. One-time account setup

1. Twilio Console → Messaging → WhatsApp: register a WhatsApp sender
   (real E.164 number) under a WhatsApp Business Account. Business
   verification may be requested by Meta — start it immediately.
2. Until approval: join the **sandbox** (Console → Messaging → Try it out →
   WhatsApp) by sending `join <your-code>` to the sandbox number. The sandbox
   allows session messages + template testing with joined phones only.
3. Point the inbound webhook (sandbox AND the real sender) to
   `POST {PUBLIC_API_URL}/v1/webhooks/whatsapp`.

## 1. Create the templates (Content API)

Set once in your shell (never in git):

```bash
export TWILIO_ACCOUNT_SID=ACxxxxxxxx
export TWILIO_AUTH_TOKEN=xxxxxxxx
```

### 1a. `loqta_order_confirm` (P8 — buyer order confirmation, quick-reply)

```bash
curl -sS -X POST https://content.twilio.com/v1/Content \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "friendly_name": "loqta_order_confirm",
    "language": "ar",
    "variables": {"1": "أحمد", "2": "LQ-000001", "3": "متجر لقطة", "4": "1399"},
    "types": {
      "twilio/quick-reply": {
        "body": "مرحبًا {{1}} 👋\nطلبك رقم {{2}} من {{3}} بإجمالي {{4}} جنيه (الدفع عند الاستلام).\nهل تؤكد الطلب؟",
        "actions": [
          {"title": "نعم، أؤكد ✅", "id": "confirm_yes"},
          {"title": "لا، إلغاء ❌", "id": "confirm_no"}
        ]
      }
    }
  }'
```

### 1b. `loqta_merchant_new_order` (P6 — merchant alert, text)

```bash
curl -sS -X POST https://content.twilio.com/v1/Content \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "friendly_name": "loqta_merchant_new_order",
    "language": "ar",
    "variables": {"1": "طلب جديد 🎉", "2": "LQ-000002 — 1399 EGP (القاهرة)"},
    "types": {
      "twilio/text": {
        "body": "🔔 {{1}}\n{{2}}\nالتفاصيل في لوحة لقطة: https://app.loqta.shop"
      }
    }
  }'
```

### 1c. `loqta_cart_nudge` (P9 — abandoned cart, text)

```bash
curl -sS -X POST https://content.twilio.com/v1/Content \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "friendly_name": "loqta_cart_nudge",
    "language": "ar",
    "variables": {"1": "متجر لقطة", "2": "https://example.loqta.shop/cart"},
    "types": {
      "twilio/text": {
        "body": "لسه في منتجات مستنياك في سلة {{1}} 🛒\nكمّل طلبك من هنا: {{2}}"
      }
    }
  }'
```

Each response contains `"sid": "HX…"` — that is the **Content SID**.

## 2. Request WhatsApp approval for each

```bash
curl -sS -X POST "https://content.twilio.com/v1/Content/HXxxxxxxxx/ApprovalRequests/whatsapp" \
  -u "$TWILIO_ACCOUNT_SID:$TWILIO_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "loqta_order_confirm", "category": "UTILITY"}'
```

Categories: `UTILITY` for `loqta_order_confirm` and `loqta_merchant_new_order`
(transactional); `MARKETING` for `loqta_cart_nudge` (Meta reviews marketing
templates more strictly — expect the longest wait there).

Check status: `GET https://content.twilio.com/v1/Content/{sid}/ApprovalRequests`.

## 3. Wire the approved SIDs

Into `backend/.env` (real values live ONLY there, never in `.env.example`):

```
TWILIO_ACCOUNT_SID=…
TWILIO_AUTH_TOKEN=…
TWILIO_WHATSAPP_NUMBER=+2…            # or the sandbox number while testing
TWILIO_CONTENT_SID_MERCHANT_ALERT=HX… # from 1b
PUBLIC_API_URL=https://api.loqta.shop # exact public URL (signature validation)
```

P8 will add `TWILIO_CONTENT_SID_ORDER_CONFIRM`; P9 adds
`TWILIO_CONTENT_SID_CART_NUDGE`. OTP needs no template — Twilio Verify's
WhatsApp channel uses pre-approved templates (set `TWILIO_VERIFY_SERVICE_SID`
in P8).

Everything is flag-gated: with these unset, the webhook answers 503, senders
no-op, and nothing else changes.
