"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ChevronRight,
  LockKeyhole,
  PlugZap,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Zap,
} from "lucide-react";
import { APP_NAME, siteConfig } from "@/config/site";
import { fetchWebsiteSettings, localizedValue, type WebsiteSettings } from "@/lib/websiteSettings";
import DownloadBadges from "./DownloadBadges";
import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { useSiteLanguage } from "./useSiteLanguage";

const homeContent = {
  en: {
    dir: "ltr",
    hero: {
      eyebrow: "Smart living made effortless",
      title: APP_NAME.en,
      description: "A modern mobile app for managing connected homes with calm control, fast access, and secure everyday automation.",
      features: "Explore Features",
      mockupGreeting: "Welcome home",
      room: "Living Room",
      statusTitle: "All systems normal",
      statusText: "Your home is connected and secure.",
    },
    devices: [
      { name: "Lights", state: "Active" },
      { name: "AC", state: "Ready" },
      { name: "Security", state: "Active" },
      { name: "Garage", state: "Ready" },
    ],
    about: {
      eyebrow: "About",
      title: "Built for homes that feel simple, responsive, and secure.",
      description: `${APP_NAME.en} brings connected devices into one approachable mobile app, helping families control essential home systems without complexity.`,
    },
    features: {
      eyebrow: "Highlights",
      title: "Everything in reach.",
      description: "Designed for quick checks, confident control, and a smoother smart-home routine.",
      items: [
        { title: "Smart device control", description: "Manage lights, AC, locks, garages, and security devices from one clean mobile experience.", icon: PlugZap },
        { title: "Real-time alerts", description: "Stay aware with instant notifications for important events across your home.", icon: Bell },
        { title: "Secure access", description: "Built around protected sessions and thoughtful controls for connected-home confidence.", icon: ShieldCheck },
        { title: "Simple routines", description: "Create faster everyday moments with room-based control and intuitive device states.", icon: Zap },
      ],
    },
    how: {
      eyebrow: "How it works",
      title: "Start in minutes.",
      steps: [`Create your ${APP_NAME.en} account`, "Pair supported smart devices", "Organize devices by room", "Control and monitor your home anywhere"],
    },
    download: {
      eyebrow: "Download",
      title: `Bring ${APP_NAME.en} to your phone.`,
      description: "Use the official store badges to open the future app listings.",
    },
  },
  ar: {
    dir: "rtl",
    hero: {
      eyebrow: "حياة ذكية أسهل كل يوم",
      title: APP_NAME.ar,
      description: "تطبيق جوال حديث لإدارة المنازل المتصلة بتحكم هادئ ووصول سريع وتجربة آمنة للأتمتة اليومية.",
      features: "استكشف المزايا",
      mockupGreeting: "مرحباً بك في المنزل",
      room: "غرفة المعيشة",
      statusTitle: "كل الأنظمة تعمل بشكل طبيعي",
      statusText: "منزلك متصل وآمن.",
    },
    devices: [
      { name: "الإضاءة", state: "نشط" },
      { name: "التكييف", state: "جاهز" },
      { name: "الأمان", state: "نشط" },
      { name: "المرآب", state: "جاهز" },
    ],
    about: {
      eyebrow: "من نحن",
      title: `صممنا ${APP_NAME.ar} لتكون المنازل الذكية أبسط وأسرع وأكثر أماناً.`,
      description: `يجمع ${APP_NAME.ar} الأجهزة المتصلة في تطبيق جوال واضح وسهل، ليساعد العائلات على التحكم بأنظمة المنزل الأساسية دون تعقيد.`,
    },
    features: {
      eyebrow: "أبرز المزايا",
      title: "كل شيء في متناولك.",
      description: "تجربة مصممة للفحص السريع والتحكم الواثق وروتين منزلي ذكي أكثر سلاسة.",
      items: [
        { title: "تحكم ذكي بالأجهزة", description: "أدر الإضاءة والتكييف والأقفال والمرائب وأجهزة الأمان من تجربة جوال واحدة.", icon: PlugZap },
        { title: "تنبيهات فورية", description: "ابق على اطلاع بالتنبيهات المهمة لحظة حدوثها في منزلك.", icon: Bell },
        { title: "وصول آمن", description: "مصمم بجلسات محمية وضوابط مدروسة تمنحك ثقة أكبر في منزلك المتصل.", icon: ShieldCheck },
        { title: "روتينات بسيطة", description: "أنجز لحظاتك اليومية بسرعة عبر التحكم حسب الغرف وحالات الأجهزة الواضحة.", icon: Zap },
      ],
    },
    how: {
      eyebrow: "كيف يعمل",
      title: "ابدأ خلال دقائق.",
      steps: [`أنشئ حسابك في ${APP_NAME.ar}`, "اقرن الأجهزة الذكية المدعومة", "نظم الأجهزة حسب الغرف", "تحكم بمنزلك وراقبه من أي مكان"],
    },
    download: {
      eyebrow: "تحميل",
      title: `اجعل ${APP_NAME.ar} قريباً منك على جوالك.`,
      description: "استخدم شارات المتاجر الرسمية لفتح صفحات التطبيق المستقبلية.",
    },
  },
} as const;

export default function HomePageClient() {
  const { language, setLanguage, isRtl, textAlign } = useSiteLanguage();
  const t = homeContent[language];
  const [websiteSettings, setWebsiteSettings] = useState<WebsiteSettings | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetchWebsiteSettings(controller.signal).then(setWebsiteSettings);
    return () => controller.abort();
  }, []);

  const heroContent = useMemo(() => ({
    eyebrow: localizedValue(websiteSettings?.hero?.badge, language, t.hero.eyebrow),
    title: localizedValue(websiteSettings?.hero?.title, language, t.hero.title),
    description: localizedValue(websiteSettings?.hero?.description, language, t.hero.description),
    ctaText: localizedValue(websiteSettings?.hero?.ctaText, language, t.hero.features),
    appStoreUrl: websiteSettings?.hero?.appStoreUrl || siteConfig.appStoreUrl,
    googlePlayUrl: websiteSettings?.hero?.googlePlayUrl || siteConfig.googlePlayUrl,
  }), [language, t.hero.description, t.hero.eyebrow, t.hero.features, t.hero.title, websiteSettings]);

  const downloadLinks = useMemo(() => ({
    appStoreUrl: websiteSettings?.download?.appStoreUrl || heroContent.appStoreUrl,
    googlePlayUrl: websiteSettings?.download?.googlePlayUrl || heroContent.googlePlayUrl,
  }), [heroContent.appStoreUrl, heroContent.googlePlayUrl, websiteSettings]);

  return (
    <main dir={t.dir} lang={language} className="min-h-screen bg-[#071A3D] text-slate-950">
      <SiteHeader language={language} setLanguage={setLanguage} />

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_34%,rgba(79,125,255,0.28),transparent_30%),radial-gradient(circle_at_22%_20%,rgba(29,78,216,0.28),transparent_34%),linear-gradient(135deg,#020617_0%,#071A3D_48%,#0B2A63_100%)]" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 py-20 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-24">
          <div className={`animate-section-in ${textAlign}`}>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-300/25 bg-white/10 px-4 py-2 text-sm font-semibold text-blue-100 shadow-sm shadow-blue-950/20 backdrop-blur">
              <Sparkles size={16} />
              {heroContent.eyebrow}
            </div>
            <h1 className="max-w-3xl bg-gradient-to-r from-white via-blue-100 to-[#4F7DFF] bg-clip-text text-5xl font-bold leading-tight tracking-normal text-transparent sm:text-6xl lg:text-7xl">
              {heroContent.title}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-blue-100/85 sm:text-xl">{heroContent.description}</p>
            <div className="animate-download-badges mt-9 flex flex-col gap-4 sm:flex-row">
              <DownloadBadges appStoreUrl={heroContent.appStoreUrl} googlePlayUrl={heroContent.googlePlayUrl} />
              <a href="#features" className="inline-flex w-fit items-center justify-center gap-2 rounded-full border border-blue-300/30 bg-white/10 px-6 py-3.5 text-sm font-bold text-white shadow-sm shadow-blue-950/20 backdrop-blur transition duration-300 hover:-translate-y-1 hover:scale-[1.02] hover:border-blue-300/60 hover:bg-white/15 hover:shadow-lg hover:shadow-blue-500/20">
                {heroContent.ctaText}
                <ArrowRight size={18} className={isRtl ? "rotate-180" : ""} />
              </a>
            </div>
          </div>

          <div className="animate-section-in relative mx-auto w-full max-w-md delay-100 lg:max-w-lg">
            <div className="absolute -inset-8 rounded-[3rem] bg-[#4F7DFF]/20 blur-3xl" />
            <div className="float-slow relative rounded-[2rem] border border-blue-300/25 bg-white/12 p-4 shadow-2xl shadow-blue-500/20 backdrop-blur transition duration-300 hover:-translate-y-1 hover:shadow-blue-500/30">
              <div className="rounded-[1.5rem] bg-gradient-to-br from-[#061a4f] via-[#0b3a8f] to-blue-700 p-5 text-white">
                <div className="mb-8 flex items-center justify-between">
                  <div className={textAlign}>
                    <p className="text-sm text-blue-100">{t.hero.mockupGreeting}</p>
                    <p className="text-2xl font-bold tracking-normal">{t.hero.room}</p>
                  </div>
                  <Smartphone className="text-cyan-300" size={28} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {t.devices.map((item, index) => (
                    <div key={item.name} className={`rounded-2xl bg-white/10 p-4 ring-1 ring-white/10 transition duration-300 hover:-translate-y-1.5 hover:scale-[1.02] hover:bg-white/15 hover:shadow-lg hover:shadow-blue-950/20 ${textAlign}`}>
                      <div className="mb-5 flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-950">
                        {index === 2 ? <LockKeyhole size={18} /> : <Zap size={18} />}
                      </div>
                      <p className="font-semibold">{item.name}</p>
                      <p className="mt-1 text-sm text-blue-100">{item.state}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl bg-cyan-300 p-4 text-[#061a4f] shadow-lg shadow-cyan-950/10">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 size={22} />
                    <div className={textAlign}>
                      <p className="font-bold">{t.hero.statusTitle}</p>
                      <p className="text-sm text-blue-900">{t.hero.statusText}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="animate-section-in bg-white py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className={`max-w-3xl ${textAlign}`}>
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-600">{t.about.eyebrow}</p>
            <h2 className="mt-4 text-3xl font-bold tracking-normal text-[#061a4f] sm:text-4xl">{t.about.title}</h2>
            <p className="mt-5 text-lg leading-8 text-slate-600">{t.about.description}</p>
          </div>
        </div>
      </section>

      <section id="features" className="animate-section-in bg-[#EAF2FF] py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className={`mb-12 flex flex-col justify-between gap-5 md:items-end ${isRtl ? "md:flex-row-reverse" : "md:flex-row"}`}>
            <div className={textAlign}>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-600">{t.features.eyebrow}</p>
              <h2 className="mt-4 text-3xl font-bold tracking-normal text-[#061a4f] sm:text-4xl">{t.features.title}</h2>
            </div>
            <p className={`max-w-xl text-slate-600 ${textAlign}`}>{t.features.description}</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {t.features.items.map((feature) => (
              <article key={feature.title} className={`rounded-2xl border border-blue-200 bg-white p-6 shadow-sm shadow-blue-950/8 transition duration-300 hover:-translate-y-1.5 hover:border-[#4F7DFF]/40 hover:shadow-xl hover:shadow-blue-500/15 ${textAlign}`}>
                <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-[#061a4f]">
                  <feature.icon size={24} />
                </div>
                <h3 className="text-lg font-bold text-[#061a4f]">{feature.title}</h3>
                <p className="mt-3 leading-7 text-slate-600">{feature.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="animate-section-in bg-[#071A3D] py-20">
        <div className="mx-auto max-w-7xl px-5 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-300">{t.how.eyebrow}</p>
            <h2 className="mt-4 text-3xl font-bold tracking-normal text-white sm:text-4xl">{t.how.title}</h2>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-4">
            {t.how.steps.map((step, index) => (
              <div key={step} className={`relative rounded-2xl border border-blue-300/20 bg-white/8 p-6 shadow-sm shadow-blue-950/20 backdrop-blur transition duration-300 hover:-translate-y-1.5 hover:border-[#4F7DFF]/50 hover:bg-white/12 hover:shadow-xl hover:shadow-blue-500/15 ${textAlign}`}>
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1D4ED8] text-sm font-bold text-white shadow-lg shadow-blue-500/25">{index + 1}</span>
                <p className="mt-5 font-bold text-blue-50">{step}</p>
                {index < t.how.steps.length - 1 && (
                  <ChevronRight className={`absolute top-9 hidden text-blue-200 md:block ${isRtl ? "-left-4 rotate-180" : "-right-4"}`} size={28} />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="download" className="animate-section-in bg-white px-5 py-20 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl rounded-[2rem] bg-gradient-to-br from-[#020617] via-[#071A3D] to-[#1D4ED8] px-6 py-14 text-white shadow-2xl shadow-blue-950/25 sm:px-10 lg:px-16">
          <div className={`grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center ${textAlign}`}>
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.18em] text-cyan-300">{t.download.eyebrow}</p>
              <h2 className="mt-4 text-3xl font-bold tracking-normal sm:text-4xl">{t.download.title}</h2>
              <p className="mt-4 max-w-2xl leading-7 text-blue-100">{t.download.description}</p>
            </div>
            <DownloadBadges appStoreUrl={downloadLinks.appStoreUrl} googlePlayUrl={downloadLinks.googlePlayUrl} />
          </div>
        </div>
      </section>

      <SiteFooter language={language} />
    </main>
  );
}
