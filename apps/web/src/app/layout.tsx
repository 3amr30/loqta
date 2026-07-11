import type { Metadata } from "next";
import { IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans_Arabic({
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "لقطة — منصة الدروبشيبينج المصرية",
  description:
    "الصق لينك المنتج من المورد، حدد هامش ربحك، وابدأ البيع على متجرك الخاص. موردين محليين + شحن سريع + دفع عند الاستلام.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body className={plex.className}>{children}</body>
    </html>
  );
}
