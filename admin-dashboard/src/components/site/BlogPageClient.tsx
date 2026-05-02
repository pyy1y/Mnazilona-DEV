"use client";

import type { BlogPost } from "@/lib/api";
import BlogCard from "./BlogCard";
import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { useSiteLanguage } from "./useSiteLanguage";

const content = {
  en: {
    eyebrow: "Blog",
    title: "Latest updates",
    description: "Product notes, smart-building ideas, and updates prepared for future admin-managed publishing.",
  },
  ar: {
    eyebrow: "المدونة",
    title: "آخر التحديثات",
    description: "ملاحظات المنتج وأفكار المباني الذكية وتحديثات جاهزة للنشر مستقبلاً من لوحة الإدارة.",
  },
} as const;

export default function BlogPageClient({ posts }: { posts: BlogPost[] }) {
  const { language, setLanguage, isRtl, textAlign } = useSiteLanguage();
  const t = content[language];

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
        <div className={`mx-auto grid max-w-7xl gap-6 px-5 sm:px-6 md:grid-cols-2 lg:grid-cols-3 lg:px-8 ${textAlign}`}>
          {posts.map((post) => (
            <BlogCard key={post.id} post={post} language={language} />
          ))}
        </div>
      </section>
      <SiteFooter language={language} />
    </main>
  );
}
