/**
 * CSV export for the orders board. UTF-8 BOM so Excel opens Arabic
 * correctly (the merchant's actual workflow). Pure - route feeds rows in.
 */

export interface OrderCsvRow {
  order_number: string;
  created_at: string | Date;
  customer_name: string;
  customer_phone: string;
  governorate: string | null;
  items: string; // pre-joined "2x title (variant) + 1x other"
  subtotal: number;
  shipping_fee: number;
  total: number;
  total_cost: number;
  status: string;
  tracking_number: string | null;
}

const HEADERS = [
  "رقم الطلب",
  "التاريخ",
  "العميل",
  "الموبايل",
  "المحافظة",
  "المنتجات",
  "المجموع",
  "الشحن",
  "الإجمالي",
  "التكلفة",
  "الربح",
  "الحالة",
  "رقم الشحنة",
];

function cell(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function ordersToCsv(rows: OrderCsvRow[]): string {
  const lines = [HEADERS.map(cell).join(",")];
  for (const r of rows) {
    const profit = Math.round((r.total - r.total_cost) * 100) / 100;
    lines.push(
      [
        r.order_number,
        new Date(r.created_at).toISOString().slice(0, 16).replace("T", " "),
        r.customer_name,
        r.customer_phone,
        r.governorate ?? "",
        r.items,
        r.subtotal,
        r.shipping_fee,
        r.total,
        r.total_cost,
        profit,
        r.status,
        r.tracking_number ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  // BOM first - Excel needs it to detect UTF-8 (Arabic otherwise garbles).
  return "﻿" + lines.join("\r\n") + "\r\n";
}
