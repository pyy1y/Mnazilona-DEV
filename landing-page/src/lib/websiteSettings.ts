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
  about?: {
    label?: LocalizedText;
    title?: LocalizedText;
    description?: LocalizedText;
  };
  download?: {
    appStoreUrl?: string;
    googlePlayUrl?: string;
  };
}

export interface ContactMessagePayload {
  name: string;
  email: string;
  phone: string;
  message: string;
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

export async function sendContactMessage(payload: ContactMessagePayload): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/website/contact`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    return response.ok;
  } catch {
    return false;
  }
}
