import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

async function prepareOfflineShell(): Promise<void> {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;

  // Some browsers expose the API but leave `ready` pending when registration
  // is blocked. Offline caching is optional; the actual local Core must still
  // be reachable so its loading/error/recovery screens can run.
  const available = await new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), 3_000);
    void navigator.serviceWorker.register("/service-worker.js", { scope: "/" })
      .then(() => navigator.serviceWorker.ready)
      .then(() => { window.clearTimeout(timeout); resolve(true); })
      .catch(() => { window.clearTimeout(timeout); resolve(false); });
  });
  if (!available) return;
  if (!navigator.serviceWorker.controller) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 3_000);
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.clearTimeout(timeout);
        resolve();
      }, { once: true });
    });
  }

  const controller = navigator.serviceWorker.controller;
  if (!controller) return;
  const urls = performance.getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((value) => {
      try {
        return new URL(value).origin === window.location.origin;
      } catch {
        return false;
      }
    });
  await new Promise<void>((resolve) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(resolve, 10_000);
    channel.port1.onmessage = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    controller.postMessage({ type: "CACHE_URLS", urls }, [channel.port2]);
  });
}

function LocalAppBootstrap() {
  const [ready, setReady] = React.useState(!import.meta.env.PROD || !("serviceWorker" in navigator));

  React.useEffect(() => {
    if (ready) return;
    let current = true;
    void prepareOfflineShell().catch(() => {
      // An unsupported or blocked service worker should not prevent local play.
    }).finally(() => {
      if (current) setReady(true);
    });
    return () => { current = false; };
  }, [ready]);

  return ready ? <App /> : <div className="offline-bootstrap" role="status">Preparing local assets…</div>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalAppBootstrap />
  </React.StrictMode>,
);
