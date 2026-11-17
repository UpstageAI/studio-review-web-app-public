import { notFound } from "next/navigation";
import { demoCatchAllParams } from "@/lib/pages-demo";

// Pages 데모(정적 export)에서만 값이 있다. 평소에는 `undefined` 라 요청 때 그린다.
export const generateStaticParams = demoCatchAllParams;

// 매칭되지 않는 경로를 [locale]/not-found.tsx 로 보낸다 (locale 레이아웃 + 번역 유지)
export default function CatchAll() {
  notFound();
}
