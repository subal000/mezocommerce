import type { MetadataRoute } from "next";
import { SITE } from "@/lib/client/site";

const PATHS: { path: string; priority: number }[] = [
  { path: "/", priority: 1 },
  { path: "/docs", priority: 0.8 },
  { path: "/docs/api", priority: 0.7 },
  { path: "/docs/lifecycle", priority: 0.6 },
  { path: "/docs/webhooks", priority: 0.6 },
  { path: "/docs/widget", priority: 0.6 },
  { path: "/docs/shopify", priority: 0.6 },
  { path: "/docs/security", priority: 0.6 },
  { path: "/demo-store", priority: 0.5 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PATHS.map(({ path, priority }) => ({ url: `${SITE.url}${path}`, lastModified: now, changeFrequency: "weekly", priority }));
}
