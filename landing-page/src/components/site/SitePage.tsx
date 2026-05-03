"use client";

import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { useSiteLanguage } from "./useSiteLanguage";

export default function SitePage({ children }: { children: React.ReactNode }) {
  const { language, setLanguage, isRtl } = useSiteLanguage();

  return (
    <main dir={isRtl ? "rtl" : "ltr"} lang={language} className="min-h-screen bg-[#071A3D] text-slate-950">
      <SiteHeader language={language} setLanguage={setLanguage} />
      {children}
      <SiteFooter language={language} />
    </main>
  );
}
