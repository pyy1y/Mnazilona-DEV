import Link from "next/link";
import type { Language } from "@/config/site";
import type { BlogPost } from "@/lib/api";

export default function BlogCard({ post, language }: { post: BlogPost; language: Language }) {
  const isAr = language === "ar";
  const title = isAr ? post.titleAr : post.title;
  const description = isAr ? post.descriptionAr : post.description;

  return (
    <article className="rounded-2xl border border-blue-200 bg-white p-6 shadow-sm shadow-blue-950/8 transition duration-300 hover:-translate-y-1.5 hover:border-[#4F7DFF]/40 hover:shadow-xl hover:shadow-blue-500/15">
      <p className="text-sm font-semibold text-blue-700">
        {new Date(post.date).toLocaleDateString(isAr ? "ar" : "en", { month: "short", day: "numeric", year: "numeric" })}
      </p>
      <h2 className="mt-4 text-2xl font-bold tracking-normal text-[#061a4f]">{title}</h2>
      <p className="mt-3 leading-7 text-slate-600">{description}</p>
      <Link href={`/blog/${post.slug}`} className="mt-6 inline-flex rounded-full bg-[#1D4ED8] px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-blue-500/20 transition hover:-translate-y-0.5 hover:bg-[#071A3D]">
        {isAr ? "اقرأ المزيد" : "Read more"}
      </Link>
    </article>
  );
}
