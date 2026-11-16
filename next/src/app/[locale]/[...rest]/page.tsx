import { notFound } from "next/navigation";

// 매칭되지 않는 경로를 [locale]/not-found.tsx 로 보낸다 (locale 레이아웃 + 번역 유지)
export default function CatchAll() {
  notFound();
}
