"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function NotificationsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/settings/email");
  }, [router]);
  return (
    <div className="p-6 flex items-center gap-3 text-sm text-stone-400">
      <span className="inline-block w-4 h-4 border-2 border-stone-600 border-t-stone-300 rounded-full animate-spin" />
      Redirecting to Email settings…
    </div>
  );
}
