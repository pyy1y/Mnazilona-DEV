import { siteConfig } from "@/config/site";

export default function DownloadBadges({ className = "" }: { className?: string }) {
  return (
    <div className={`flex flex-col gap-4 sm:flex-row ${className}`}>
      <a
        href={siteConfig.appStoreUrl}
        className="inline-flex w-fit transition duration-300 hover:scale-[1.03] hover:drop-shadow-[0_0_18px_rgba(79,125,255,0.45)]"
        aria-label="App Store"
      >
        <img src="/app-store-badge.svg" alt="App Store" className="h-14 w-auto" />
      </a>
      <a
        href={siteConfig.googlePlayUrl}
        className="inline-flex w-fit transition duration-300 hover:scale-[1.03] hover:drop-shadow-[0_0_18px_rgba(79,125,255,0.45)]"
        aria-label="Google Play"
      >
        <img src="/google-play-badge.svg" alt="Google Play" className="h-14 w-auto" />
      </a>
    </div>
  );
}
