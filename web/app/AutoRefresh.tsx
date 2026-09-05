"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch the current route's server render on an interval. Used on server-rendered pages whose
 *  data moves (the board during a run): the refresh re-runs the server component with fresh data
 *  while every piece of client state on the page — sort, paging, expanded rows — survives it.
 *  Renders nothing; pass active=false to stop. */
export default function AutoRefresh({ intervalMs = 5000, active = true }: { intervalMs?: number; active?: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [router, intervalMs, active]);
  return null;
}
