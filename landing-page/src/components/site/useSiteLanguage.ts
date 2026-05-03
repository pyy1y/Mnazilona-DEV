"use client";

import { useEffect, useState } from "react";
import { arabicFont } from "@/app/fonts";
import type { Language } from "@/config/site";

const STORAGE_KEY = "language";

function readStoredLanguage(): Language {
  if (typeof window === "undefined") return "en";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === "ar" ? "ar" : "en";
}

export function useSiteLanguage() {
  const [language, setLanguage] = useState<Language>(readStoredLanguage);
  const isRtl = language === "ar";

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, language);
    document.documentElement.lang = language;
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.body.classList.toggle(arabicFont.className, isRtl);

    return () => {
      document.body.classList.remove(arabicFont.className);
      document.documentElement.lang = "en";
      document.documentElement.dir = "ltr";
    };
  }, [isRtl, language]);

  return {
    language,
    setLanguage,
    isRtl,
    textAlign: isRtl ? "text-right" : "text-left",
    rowDirection: isRtl ? "sm:flex-row-reverse" : "sm:flex-row",
  };
}
