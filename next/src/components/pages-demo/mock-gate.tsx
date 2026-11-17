"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PAGES_BASE_PATH } from "@/lib/pages-demo";

// GitHub Pages 데모 전용(`PAGES_DEMO`). 서버가 없으므로 `/api/...` 는 서비스 워커(`mock-sw.js`)가 답한다.
// 워커가 이 페이지를 맡기 전에 화면이 API 를 부르면 실패하므로, 맡을 때까지 화면을 그리지 않는다.

const RELOAD_KEY = "pages-demo:reloaded";
const CONTROL_TIMEOUT_MS = 5000;

type GateState = "starting" | "ready" | "failed";

async function startWorker(): Promise<GateState> {
  if (!("serviceWorker" in navigator)) return "failed";
  const container = navigator.serviceWorker;
  await container.register(`${PAGES_BASE_PATH}/mock-sw.js`, {
    scope: `${PAGES_BASE_PATH}/`,
  });
  await container.ready;
  if (!container.controller) {
    // 첫 방문: 워커가 `clients.claim()` 으로 이 페이지를 맡을 때까지 기다린다.
    await new Promise<void>(resolve => {
      container.addEventListener("controllerchange", () => resolve(), {
        once: true,
      });
      setTimeout(resolve, CONTROL_TIMEOUT_MS);
    });
  }
  if (container.controller) {
    sessionStorage.removeItem(RELOAD_KEY);
    return "ready";
  }
  // 강력 새로 고침(Shift+Reload)은 서비스 워커를 건너뛴다. 한 번만 보통 새로 고침으로 다시 연다.
  if (sessionStorage.getItem(RELOAD_KEY) === null) {
    sessionStorage.setItem(RELOAD_KEY, "1");
    window.location.reload();
    return "starting";
  }
  return "failed";
}

export function MockGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("starting");

  useEffect(() => {
    let active = true;
    startWorker()
      .catch(() => "failed" as const)
      .then(next => {
        if (active) setState(next);
      });
    return () => {
      active = false;
    };
  }, []);

  if (state === "ready") return <>{children}</>;
  return (
    <p
      role="status"
      data-testid="pages-demo-gate"
      className="m-auto p-8 text-sm text-muted-foreground"
    >
      {state === "starting"
        ? "Starting the demo…"
        : "This demo runs its mock API in a service worker, which this browser does not allow here. Try a regular (non-private) window."}
    </p>
  );
}
