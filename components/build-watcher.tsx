"use client";

import { useEffect, useRef } from "react";

/**
 * Detects a newly deployed build and reloads the page once, so an open tab
 * never keeps running stale JavaScript after an update.
 */
export function BuildWatcher({ buildId }: { buildId: string }) {
  const currentBuild = useRef(buildId);

  useEffect(() => {
    currentBuild.current = buildId;
  }, [buildId]);

  useEffect(() => {
    let stopped = false;
    let reloading = false;

    const check = async () => {
      if (stopped || reloading) return;
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as { buildId?: string };
        if (data.buildId && data.buildId !== currentBuild.current) {
          reloading = true;
          window.location.reload();
        }
      } catch {
        // Network hiccup; try again on the next tick.
      }
    };

    // Check on interaction with the tab and periodically as a fallback.
    const interval = window.setInterval(check, 60000);
    const onFocus = () => check();
    const onVisibility = () => {
      if (document.visibilityState === "visible") check();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stopped = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return null;
}
