"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const HeaderSlotContext = createContext<{
  target: HTMLElement | null;
  setTarget: (element: HTMLElement | null) => void;
} | null>(null);

/**
 * 공통 상단 바 안에 화면마다 다른 내용을 넣는 자리. 상단 바는 레이아웃에 있어 화면의 상태를 모르므로,
 * 화면이 `HeaderSlot` 으로 내용을 그 자리(`HeaderSlotTarget`)에 옮겨 그린다(포털). 자리는 브라우저에서
 * 붙은 뒤에 생기므로 서버 렌더와 첫 화면에는 비어 있다.
 */
export function HeaderSlotProvider({ children }: { children: ReactNode }) {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlotContext value={{ target, setTarget }}>
      {children}
    </HeaderSlotContext>
  );
}

/** 상단 바 안에서 화면이 채울 자리. */
export function HeaderSlotTarget({ className }: { className?: string }) {
  const context = use(HeaderSlotContext);
  return (
    <div
      ref={context?.setTarget}
      className={className}
      data-testid="app-header-slot"
    />
  );
}

/**
 * 이 내용을 공통 상단 바의 화면 자리에 그린다. provider 가 없으면(상단 바가 없는 곳) 제자리에 그린다.
 * provider 는 있는데 자리가 아직 붙지 않았으면 그리지 않는다 — 제자리에 그렸다가 자리가 생긴 뒤 옮기면
 * 첫 화면에서 내용이 튄다.
 */
export function HeaderSlot({ children }: { children: ReactNode }) {
  const context = use(HeaderSlotContext);
  if (context === null) return children;
  return context.target ? createPortal(children, context.target) : null;
}
