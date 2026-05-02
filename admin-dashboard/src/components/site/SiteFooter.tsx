import Link from "next/link";
import { getSiteName, type Language } from "@/config/site";

const labels = {
  en: {
    rights: "All rights reserved.",
    privacy: "Privacy Policy",
    terms: "Terms of Use",
  },
  ar: {
    rights: "جميع الحقوق محفوظة.",
    privacy: "سياسة الخصوصية",
    terms: "شروط الاستخدام",
  },
};

export default function SiteFooter({ language }: { language: Language }) {
  const t = labels[language];
  const rowDirection = language === "ar" ? "sm:flex-row-reverse" : "sm:flex-row";

  return (
    <footer className="border-t border-blue-300/20 bg-[#020617]">
      <div className={`mx-auto flex max-w-7xl flex-col gap-4 px-5 py-8 text-sm text-blue-100/75 sm:items-center sm:justify-between sm:px-6 lg:px-8 ${rowDirection}`}>
        <p>© 2026 {getSiteName(language)}. {t.rights}</p>
        <div className="flex gap-5">
          <Link href="/privacy" className="transition hover:text-white">{t.privacy}</Link>
          <Link href="/terms" className="transition hover:text-white">{t.terms}</Link>
        </div>
      </div>
    </footer>
  );
}
