"use client";

import { Mail, MapPin, MessageCircle } from "lucide-react";
import { siteConfig } from "@/config/site";
import ContactForm from "./ContactForm";
import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { useSiteLanguage } from "./useSiteLanguage";

const content = {
  en: {
    eyebrow: "Contact",
    title: "Let us help you connect your home.",
    description: "Reach out for support, partnerships, or product questions. This page is ready to connect to backend submissions later.",
    email: "Email",
    support: "Support",
    location: "Location",
    locationValue: "Saudi Arabia",
  },
  ar: {
    eyebrow: "اتصل بنا",
    title: "دعنا نساعدك على توصيل منزلك.",
    description: "تواصل معنا للدعم أو الشراكات أو أسئلة المنتج. هذه الصفحة جاهزة للربط بإرسال الطلبات إلى الخادم لاحقاً.",
    email: "البريد الإلكتروني",
    support: "الدعم",
    location: "الموقع",
    locationValue: "المملكة العربية السعودية",
  },
} as const;

export default function ContactPageClient() {
  const { language, setLanguage, isRtl, textAlign } = useSiteLanguage();
  const t = content[language];

  const items = [
    { label: t.email, value: siteConfig.contactEmail, icon: Mail },
    { label: t.support, value: siteConfig.supportPhone, icon: MessageCircle },
    { label: t.location, value: t.locationValue, icon: MapPin },
  ];

  return (
    <main dir={isRtl ? "rtl" : "ltr"} lang={language} className="min-h-screen bg-[#071A3D] text-slate-950">
      <SiteHeader language={language} setLanguage={setLanguage} />
      <section className="relative overflow-hidden bg-[radial-gradient(circle_at_70%_20%,rgba(79,125,255,0.25),transparent_30%),linear-gradient(135deg,#020617_0%,#071A3D_55%,#0B2A63_100%)] px-5 py-20 sm:px-6 lg:px-8">
        <div className={`mx-auto max-w-7xl ${textAlign}`}>
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-300">{t.eyebrow}</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-bold tracking-normal text-white sm:text-5xl">{t.title}</h1>
          <p className="mt-5 max-w-2xl leading-8 text-blue-100/85">{t.description}</p>
        </div>
      </section>
      <section className="bg-[#EAF2FF] py-20">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 sm:px-6 lg:grid-cols-[0.85fr_1.15fr] lg:px-8">
          <div className="grid gap-4">
            {items.map((item) => (
              <div key={item.label} className={`rounded-2xl border border-blue-200 bg-white p-5 shadow-sm shadow-blue-950/8 transition duration-300 hover:-translate-y-1 hover:border-[#4F7DFF]/40 hover:shadow-lg hover:shadow-blue-500/15 ${textAlign}`}>
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-[#061a4f]">
                    <item.icon size={21} />
                  </div>
                  <div>
                    <p className="font-bold text-[#061a4f]">{item.label}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{item.value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <ContactForm language={language} />
        </div>
      </section>
      <SiteFooter language={language} />
    </main>
  );
}
