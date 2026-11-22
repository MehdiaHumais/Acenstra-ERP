"use client";

import { useEffect } from "react";

export function ServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    if (process.env.NODE_ENV !== "production") {
      return;
    }

    // Only treat a controller change as an update when this page was already
    // controlled. On a first-ever visit there is nothing to refresh.
    const hadController = Boolean(navigator.serviceWorker.controller);
    let reloading = false;
    let registration: ServiceWorkerRegistration | null = null;

    const reloadForUpdate = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };

    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "RELOAD_FOR_UPDATE") {
        reloadForUpdate();
      }
    };

    const checkForUpdate = () => {
      registration?.update().catch(() => undefined);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    const register = () => {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then((reg) => {
          registration = reg;
          checkForUpdate();
        })
        .catch(() => undefined);
    };

    navigator.serviceWorker.addEventListener("message", handleMessage);
    navigator.serviceWorker.addEventListener("controllerchange", reloadForUpdate);

    // `load` may already have fired by the time React hydrates, so register
    // immediately when the document is complete and only wait otherwise.
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
    window.addEventListener("focus", checkForUpdate);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      navigator.serviceWorker.removeEventListener("message", handleMessage);
      navigator.serviceWorker.removeEventListener("controllerchange", reloadForUpdate);
      window.removeEventListener("load", register);
      window.removeEventListener("focus", checkForUpdate);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return null;
}
