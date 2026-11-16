import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type StepCardProps = {
  /** 화면에 보이는 단계 문구 (예: "1 단계") */
  stepLabel: string;
  icon: ReactNode;
  title: string;
  description: string;
  items: readonly string[];
  preview: ReactNode;
  badge?: string;
};

/**
 * 홈에서 검수 흐름의 한 화면을 소개하는 카드. `<ol>` 안의 `<li>` 로 렌더한다. 화면으로 들어가는 길은
 * 홈 위쪽 "시작하기" 버튼 하나로 모은다.
 */
export function StepCard({
  stepLabel,
  icon,
  title,
  description,
  items,
  preview,
  badge,
}: StepCardProps) {
  return (
    <li className="flex">
      <Card className="w-full">
        <div className="px-(--card-spacing)">{preview}</div>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{stepLabel}</Badge>
            {badge ? <Badge variant="outline">{badge}</Badge> : null}
          </div>
          {/* CardTitle 은 div 로 렌더되므로 카드 제목임을 보조 기술에 알린다 */}
          <CardTitle
            role="heading"
            aria-level={2}
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <span className="text-primary [&>svg]:size-5" aria-hidden>
              {icon}
            </span>
            {title}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex-1">
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground marker:text-primary/60">
            {items.map(item => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </li>
  );
}
