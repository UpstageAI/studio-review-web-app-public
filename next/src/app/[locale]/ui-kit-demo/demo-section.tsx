import type { ReactNode } from "react";

/** 데모 화면 testid 접두. */
export const TEST_ID = "ui-kit-demo";

/** item 하나의 데모 칸(제목·설명 + 내용). */
export function Section({
  title,
  description,
  children,
  testId,
}: {
  title: string;
  description: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section
      className="flex flex-col gap-4 rounded-lg border border-border bg-background p-5"
      data-testid={testId}
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** 지역 state 를 글자로 보이는 줄(스모크가 읽는다). */
export function StateLine({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}) {
  return (
    <p
      className="font-mono text-xs break-all text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </p>
  );
}
