/** Order lifecycle guard: pending -> confirmed -> fulfilled -> shipped ->
 *  delivered; cancel from pending/confirmed; return from delivered. */

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "fulfilled"
  | "shipped"
  | "delivered"
  | "cancelled"
  | "returned";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["fulfilled", "cancelled"],
  fulfilled: ["shipped"],
  shipped: ["delivered"],
  delivered: ["returned"],
  cancelled: [],
  returned: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return TRANSITIONS[from] ?? [];
}
