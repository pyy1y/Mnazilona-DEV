"use client";

import { useEffect } from "react";

export default function RootPage() {
  useEffect(() => {
    if (window.location.pathname !== "/admin") {
      window.location.replace("/admin");
    }
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full" />
    </div>
  );
}
