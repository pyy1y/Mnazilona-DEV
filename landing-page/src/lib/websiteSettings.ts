import type { Language } from "@/config/site";

export type LocalizedText = Partial<Record<Language, string>>;

export interface WebsiteSettings {
  hero?: {
    badge?: LocalizedText;
    title?: LocalizedText;
    description?: LocalizedText;
    imageUrl?: string;
    appStoreUrl?: string;
    googlePlayUrl?: string;
    ctaText?: LocalizedText;
  };
  download?: {
    appStoreUrl?: string;
    googlePlayUrl?: string;
  };
}

const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "https://mnazilona.xyz/api/v1").replace(/\/$/, "");

export async function fetchWebsiteSettings(signal?: AbortSignal): Promise<WebsiteSettings | null> {
  try {
    const response = await fetch(`${API_BASE}/website/settings`, {
      cache: "no-store",
      signal,
    });

    if (!response.ok) return null;

    const data = await response.json();
    return data?.settings || data || null;
  } catch {
    return null;
  }
}

export function localizedValue(value: LocalizedText | undefined, language: Language, fallback: string) {
  return value?.[language]?.trim() || fallback;
}
