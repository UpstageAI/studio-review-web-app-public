import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { setRequestLocale } from "next-intl/server";
import { PAGE_CONTAINER } from "@/components/page-container";
import type { Locale } from "@/i18n/config";
import { DemoView } from "./demo-view";

export const metadata: Metadata = { robots: { index: false } };

/**
 * Review UI Kit Core 데모 화면. 서버 환경 변수 `REVIEW_UI_KIT_DEMO=1` 일 때만 열리고, 아니면 404 다.
 * 플래그는 요청 시점에 읽는다(`connection()` 뒤) — 빌드 때 값으로 굳지 않아 같은 빌드를 env 만 바꿔
 * 다시 띄우면 켜고 끌 수 있다. 내비게이션에는 링크를 두지 않는다.
 */
export default async function UiKitDemoPage({
  params,
}: PageProps<"/[locale]/ui-kit-demo">) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);

  await connection();
  if (process.env.REVIEW_UI_KIT_DEMO !== "1") notFound();

  return (
    <main className={`${PAGE_CONTAINER} flex flex-1 flex-col py-8`}>
      <DemoView />
    </main>
  );
}
