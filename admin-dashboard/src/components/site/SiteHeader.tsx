"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home } from "lucide-react";
import { getSiteName, type Language } from "@/config/site";

const labels = {
  en: {
    home: "Home",
    about: "About",
    blog: "Blog",
    contact: "Contact Us",
    download: "Download",
    language: "EN / AR",
  },
  ar: {
    home: "الرئيسية",
    about: "من نحن",
    blog: "المدونة",
    contact: "اتصل بنا",
    download: "تحميل",
    language: "EN / AR",
  },
};

export default function SiteHeader({
  language,
  setLanguage,
}: {
  language: Language;
  setLanguage: (language: Language) => void;
}) {
  const pathname = usePathname();
  const t = labels[language];

  const linkClass = (active: boolean) =>
    `border-b-2 pb-1 transition duration-200 hover:-translate-y-0.5 hover:scale-105 hover:border-[#4F7DFF] hover:text-white ${
      active ? "border-[#4F7DFF] text-white" : "border-transparent text-blue-100/80"
    }`;

  return (
    <header className="sticky top-0 z-30 border-b border-blue-400/20 bg-[#020617]/88 shadow-sm shadow-blue-950/30 backdrop-blur-xl">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-5 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1D4ED8] text-white shadow-lg shadow-blue-500/20">
            <Home size={20} />
          </span>
          <span className="text-lg font-bold tracking-normal text-white">{getSiteName(language)}</span>
        </Link>

        <div className="hidden items-center gap-6 text-sm font-semibold lg:flex">
          <Link href="/" className={linkClass(pathname === "/")}>{t.home}</Link>
          <Link href="/#about" className={linkClass(false)}>{t.about}</Link>
          <Link href="/blog" className={linkClass(pathname.startsWith("/blog"))}>{t.blog}</Link>
          <Link href="/#download" className={linkClass(false)}>{t.download}</Link>
          <Link href="/contact" className={linkClass(pathname === "/contact")}>{t.contact}</Link>
          <button
            type="button"
            onClick={() => setLanguage(language === "en" ? "ar" : "en")}
            className="rounded-full border border-blue-300/30 bg-blue-500/10 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-300/60 hover:bg-blue-500/20 hover:shadow-md hover:shadow-blue-500/20"
            aria-label="Toggle language"
          >
            {t.language}
          </button>
        </div>

        <button
          type="button"
          onClick={() => setLanguage(language === "en" ? "ar" : "en")}
          className="rounded-full border border-blue-300/30 bg-blue-500/10 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-300/60 hover:bg-blue-500/20 hover:shadow-md hover:shadow-blue-500/20 lg:hidden"
          aria-label="Toggle language"
        >
          {t.language}
        </button>
      </nav>
    </header>
  );
}
