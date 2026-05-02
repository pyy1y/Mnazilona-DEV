import BlogPageClient from "@/components/site/BlogPageClient";
import { getPosts } from "@/lib/api";

export default async function BlogPage() {
  const posts = await getPosts();

  return <BlogPageClient posts={posts} />;
}
