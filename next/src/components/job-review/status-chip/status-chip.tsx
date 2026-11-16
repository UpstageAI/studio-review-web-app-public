import type { ComponentProps, ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** 검수 항목 상태: 바뀜 · 재확인 필요 · 편집 불가. */
export type StatusChipKind = "changed" | "recheck" | "locked";

export interface StatusChipProps extends Omit<
  ComponentProps<"span">,
  "children"
> {
  kind: StatusChipKind;
  /** 칩 문구(예: "바뀜"). */
  children: ReactNode;
  /** 칩 옆에 붙는 한 줄 사유(예: 편집할 수 없는 이유). */
  reason?: ReactNode;
}

const VARIANT = {
  changed: "default",
  recheck: "outline",
  locked: "secondary",
} as const;

/**
 * 상태 칩. 강조색(`primary`)은 "바뀜" 에만 쓰고, 재확인 필요는 테두리, 편집 불가는 회색이다.
 * 사유가 있으면 칩 뒤에 작은 글씨로 붙인다.
 */
export function StatusChip({
  kind,
  children,
  reason,
  className,
  ...props
}: StatusChipProps) {
  return (
    <span
      {...props}
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-1.5 text-xs",
        className,
      )}
      data-status={kind}
    >
      <Badge variant={VARIANT[kind]}>{children}</Badge>
      {reason ? (
        <span className="min-w-0 text-muted-foreground">{reason}</span>
      ) : null}
    </span>
  );
}
