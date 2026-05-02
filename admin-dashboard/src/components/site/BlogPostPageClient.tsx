"use client";

import Link from "next/link";
import type { BlogPost } from "@/lib/api";
import SiteFooter from "./SiteFooter";
import SiteHeader from "./SiteHeader";
import { useSiteLanguage } from "./useSiteLanguage";

export default function BlogPostPageClient({ post }: { post: BlogPost }) {
  const { language, setLanguage, isRtl, textAlign } = useSiteLanguage();
  const title = language === "ar" ? post.titleAr : post.title;
  const description = language === "ar" ? post.descriptionAr : post.description;
  const content = language === "ar" ? post.contentAr : post.content;

  return (
    <main dir={isRtl ? "rtl" : "ltr"} lang={language} className="min-h-screen bg-[#071A3D] text-slate-950">
      <SiteHeader language={language} setLanguage={setLanguage} />
      <article>
        <section className="relative overflow-hidden bg-[radial-gradient(circle_at_70%_20%,rgba(79,125,255,0.25),transparent_30%),linear-gradient(135deg,#020617_0%,#071A3D_55%,#0B2A63_100%)] px-5 py-20 sm:px-6 lg:px-8">
          <div className={`mx-auto max-w-4xl ${textAlign}`}>
            <Link href="/blog" className="text-sm font-bold text-cyan-300 transition hover:text-white">
              {language === "ar" ? "العودة إلى المدونة" : "Back to blog"}
            </Link>
            <p className="mt-8 text-sm font-semibold text-blue-100/75">
              {new Date(post.date).toLocaleDateString(language === "ar" ? "ar" : "en", { month: "long", day: "numeric", year: "numeric" })}
            </p>
            <h1 className="mt-4 text-4xl font-bold tracking-normal text-white sm:text-5xl">{title}</h1>
            <p className="mt-5 leading-8 text-blue-100/85">{description}</p>
          </div>
        </section>
        <section className="bg-white py-20">
          <div className={`mx-auto max-w-3xl px-5 text-lg leading-9 text-slate-700 sm:px-6 lg:px-8 ${textAlign}`}>
            <p>{content}</p>
          </div>
        </section>
      </article>
      <SiteFooter language={language} />
    </main>
  );
}
