"use client";

import type { LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export interface SegmentedIconOption<T extends string> {
  value: T;
  /** 툴팁과 접근성 이름. */
  label: string;
  icon: LucideIcon;
  testId: string;
}

/**
 * 아이콘 몇 개 중 하나를 고르는 보기 방식 묶음. 눌린 쪽이 `aria-pressed` 이고 흰 바탕으로 떠 보인다.
 * 이름은 툴팁과 접근성 이름으로 알린다. `bar` 는 뷰어 아래 툴바의 다른 묶음(높이 32px, 옅은 회색
 * 바탕, 28px 버튼)과 같은 모양이고, `compact` 는 패널 머리 줄에 맞춘 작은 모양이다.
 */
export function SegmentedIcons<T extends string>({
  label,
  options,
  value,
  onChange,
  variant = "compact",
  tooltipSide = "bottom",
  className,
}: {
  /** 묶음의 접근성 이름. */
  label: string;
  options: readonly SegmentedIconOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: "bar" | "compact";
  tooltipSide?: "top" | "bottom";
  className?: string;
}) {
  const bar = variant === "bar";
  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="group"
        aria-label={label}
        className={cn(
          "flex shrink-0 items-center gap-0.5 p-0.5",
          bar ? "h-8 rounded-lg bg-muted/60" : "h-7 rounded-md bg-muted",
          className,
        )}
      >
        {options.map(option => {
          const pressed = option.value === value;
          const Icon = option.icon;
          return (
            <Tooltip key={option.value}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-pressed={pressed}
                  aria-label={option.label}
                  onClick={() => {
                    if (!pressed) onChange(option.value);
                  }}
                  data-testid={option.testId}
                  className={cn(
                    "inline-flex shrink-0 cursor-pointer items-center justify-center transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden motion-reduce:transition-none",
                    bar ? "size-7 rounded-md" : "size-6 rounded-[5px]",
                    pressed
                      ? "bg-background text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon aria-hidden="true" className="size-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side={tooltipSide}>{option.label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
