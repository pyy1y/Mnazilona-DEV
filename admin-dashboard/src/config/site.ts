export type Language = "en" | "ar";

export const APP_NAME = {
  en: "Alma",
  ar: "ألما",
};

export const siteConfig = {
  siteNameEn: APP_NAME.en,
  siteNameAr: APP_NAME.ar,
  appStoreUrl: "#",
  googlePlayUrl: "#",
  contactEmail: "hello@alma.app",
  supportPhone: "+966 50 000 0000",
};

export function getSiteName(language: Language) {
  return language === "ar" ? siteConfig.siteNameAr : siteConfig.siteNameEn;
}
