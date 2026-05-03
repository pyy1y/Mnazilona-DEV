import type { Metadata } from "next";
import "./globals.css";
import { APP_NAME } from "@/config/site";
import { arabicFont } from "./fonts";

export const metadata: Metadata = {
  title: APP_NAME.en,
  description: "A modern smart home mobile app for connected living.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${arabicFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-gray-50">
        {children}
      </body>
    </html>
  );
}
