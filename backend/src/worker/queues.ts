/** pg-boss queue names + payload types, in one place. */
export const Q = {
  importProduct: "import.product",     // { importJobId: string }
  syncTick: "sync.tick",               // scheduled — fans out sync.product jobs
  syncProduct: "sync.product",         // { sourceProductId: string }
  generateContent: "content.generate", // { listingId: string }
  processImage: "image.process",       // { listingId: string, imageUrl: string }
  notifyDispatch: "notify.dispatch",   // { notificationId: string } — email/whatsapp mirror
  whatsappConfirm: "whatsapp.confirm", // { orderId: string } — P8 order-confirm template
  confirmTimeout: "confirm.timeout",   // scheduled — flags no-response orders
} as const;

export interface ImportProductPayload { importJobId: string }
export interface SyncProductPayload { sourceProductId: string }
export interface GenerateContentPayload { listingId: string }
export interface ProcessImagePayload { listingId: string; imageUrl: string }
export interface NotifyDispatchPayload { notificationId: string }
export interface WhatsappConfirmPayload { orderId: string }
