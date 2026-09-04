import type { Metadata } from "next";
import QrDialogLink from "./qr-dialog-link";
import "./globals.css";
import "./compact.css";
import "./age-groups.css";
import "./qr-dialog-link.css";
import "./wait-public.css";

export const metadata: Metadata = {
  title: "文化祭 受付・整理券システム",
  description: "文化祭の入退場人数、整理券、案内状況を複数端末で管理します。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">
        {children}
        <QrDialogLink />
      </body>
    </html>
  );
}
