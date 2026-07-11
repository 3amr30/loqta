/** pg-boss queue names + payload types, in one place. */
export const Q = {
  importProduct: "import.product",     // { importJobId: string }
  syncTick: "sync.tick",               // scheduled — fans out sync.product jobs
  syncProduct: "sync.product",         // { sourceProductId: string }
  generateContent: "content.generate", // { listingId: string }
  processImage: "image.process",       // { listingId: string, imageUrl: string }
  notifyDispatch: "notify.dispatch",   // { notificationId: string } — email/whatsapp mirror
} as const;

export interface ImportProductPayload { importJobId: string }
export interface SyncProductPayload { sourceProductId: string }
export interface GenerateContentPayload { listingId: string }
export interface ProcessImagePayload { listingId: string; imageUrl: string }
export interface NotifyDispatchPayload { notificationId: string }
