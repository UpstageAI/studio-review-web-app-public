import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

type StepStripItem = {
  key: string;
  /** 화면에 보이는 단계 문구 (예: "1 단계") */
  stepLabel: string;
  icon: ReactNode;
  title: string;
  description: string;
};

/**
 * 대시보드가 보일 때 소개 카드 대신 쓰는 한 줄짜리 검수 흐름 소개. 미리 보기 그림과 기능 목록 없이 단계,
 * 제목, 한 줄 설명만 한 카드 안에 나란히 둔다.
 */
export function StepStrip({
  label,
  steps,
}: {
  /** 목록 이름(보조 기술용). */
  label: string;
  steps: readonly StepStripItem[];
}) {
  return (
    <ol
      aria-label={label}
      className="grid divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-xs md:grid-cols-3 md:divide-x md:divide-y-0"
      data-testid="home-steps-compact"
    >
      {steps.map(step => (
        <li key={step.key} className="flex min-w-0 flex-col gap-1 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-primary [&>svg]:size-4" aria-hidden>
              {step.icon}
            </span>
            <h2 className="min-w-0 truncate text-sm font-medium text-foreground">
              {step.title}
            </h2>
            <Badge variant="secondary" className="ml-auto shrink-0">
              {step.stepLabel}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">{step.description}</p>
        </li>
      ))}
    </ol>
  );
}
