"use client";

import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { useSiteLanguage } from "./useSiteLanguage";

const content = {
  privacy: {
    en: {
      eyebrow: "Policy",
      title: "Privacy Policy",
      body: "This placeholder policy is ready to be replaced with the official privacy terms for the product. Future versions can load this content from the admin dashboard or a CMS-backed API.",
    },
    ar: {
      eyebrow: "السياسة",
      title: "سياسة الخصوصية",
      body: "هذه سياسة مؤقتة جاهزة للاستبدال بشروط الخصوصية الرسمية للمنتج. يمكن للإصدارات القادمة تحميل هذا المحتوى من لوحة الإدارة أو من واجهة محتوى مرتبطة.",
    },
  },
  terms: {
    en: {
      eyebrow: "Legal",
      title: "Terms of Use",
      body: "These placeholder terms define the structure for future legal content. The text can later be managed through an admin-controlled content endpoint without changing the page layout.",
    },
    ar: {
      eyebrow: "قانوني",
      title: "شروط الاستخدام",
      body: "تحدد هذه الشروط المؤقتة بنية المحتوى القانوني المستقبلي. يمكن إدارة النص لاحقاً عبر نقطة محتوى مرتبطة بلوحة الإدارة دون تغيير تخطيط الصفحة.",
    },
  },
} as const;

export default function LegalPageClient({ type }: { type: "privacy" | "terms" }) {
  const { language, setLanguage, isRtl, textAlign } = useSiteLanguage();
  const t = content[type][language];

  return (
    <main dir={isRtl ? "rtl" : "ltr"} lang={language} className="min-h-screen bg-[#071A3D] text-slate-950">
      <SiteHeader language={language} setLanguage={setLanguage} />
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_70%_20%,rgba(79,125,255,0.25),transparent_30%),linear-gradient(135deg,#020617_0%,#071A3D_55%,#0B2A63_100%)] px-5 py-20 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-7xl ${textAlign}`}>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-300">{t.eyebrow}</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-normal text-white sm:text-5xl">{t.title}</h1>
        </div>
      </section>
      <section className="bg-white py-20">
        <div className={`mx-auto max-w-3xl px-5 leading-8 text-slate-700 sm:px-6 lg:px-8 ${textAlign}`}>
          <p>{t.body}</p>
        </div>
      </section>
      <SiteFooter language={language} />
    </main>
  );
}
