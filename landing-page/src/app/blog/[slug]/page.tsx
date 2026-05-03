import { notFound } from "next/navigation";
import BlogPostPageClient from "@/components/site/BlogPostPageClient";
import { getPostBySlug, getPosts } from "@/lib/posts";

export async function generateStaticParams() {
  const posts = await getPosts();
  return posts.map((post) => ({ slug: post.slug }));
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const post = await getPostBySlug(slug);

  if (!post) notFound();

  return <BlogPostPageClient post={post} />;
}
