import { useSyncExternalStore } from "react";

export interface CartItem {
  listingId: string;
  variantId?: string;
  slug: string;
  title: string;
  variantTitle?: string;
  image?: string;
  unitPrice: number; // display only - the server recomputes at checkout
  qty: number;
}

const KEY = "loqta_cart_v1";
let cache: CartItem[] | null = null;
const listeners = new Set<() => void>();

function read(): CartItem[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as CartItem[];
  } catch {
    cache = [];
  }
  return cache;
}

function write(items: CartItem[]) {
  cache = items;
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}

const keyOf = (i: Pick<CartItem, "listingId" | "variantId">) =>
  `${i.listingId}:${i.variantId ?? ""}`;

export function addToCart(item: Omit<CartItem, "qty">, qty = 1) {
  const items = [...read()];
  const idx = items.findIndex((x) => keyOf(x) === keyOf(item));
  if (idx >= 0) items[idx] = { ...items[idx]!, qty: Math.min(items[idx]!.qty + qty, 20) };
  else items.push({ ...item, qty });
  write(items);
}

export function setQty(item: Pick<CartItem, "listingId" | "variantId">, qty: number) {
  const items = read()
    .map((x) => (keyOf(x) === keyOf(item) ? { ...x, qty } : x))
    .filter((x) => x.qty > 0);
  write(items);
}

export function clearCart() {
  write([]);
}

export function useCart(): CartItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => [],
  );
}
