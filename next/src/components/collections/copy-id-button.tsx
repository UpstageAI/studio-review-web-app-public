"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** 복사했다는 표시를 보이는 시간(ms). */
const COPIED_MS = 1500;

/** 마지막으로 누른 결과. 같은 결과를 연달아 내도 표시 시간을 새로 재도록 매번 새 객체로 둔다. */
type CopyResult = { status: "copied" | "failed" };

/**
 * Collection ID 를 클립보드에 복사하는 작은 버튼. hover, 키보드 focus 하면 툴팁에 ID 와 "눌러서 복사" 가
 * 보인다. 누르면 툴팁이 닫히지 않고 잠시 "복사했습니다" 를 보인다. 클립보드를 쓸 수 없으면(예: http
 * 주소) 툴팁을 열어 둔 채 ID 를 직접 선택해 복사하라고 알리고, ID 는 한 번 눌러 통째로 선택된다. 이
 * 안내는 Escape 나 툴팁 밖을 누르면 닫힌다. 결과는 화면 낭독기에도 알린다.
 */
export function CopyIdButton({ id, testId }: { id: string; testId: string }) {
  const t = useTranslations("collections.copyId");
  const [result, setResult] = useState<CopyResult | null>(null);
  // hover, focus 로 열고 닫는 상태(Radix 가 정한다). 결과를 보이는 동안은 이것과 상관없이 열어 둔다.
  const [hoverOpen, setHoverOpen] = useState(false);

  useEffect(() => {
    if (result?.status !== "copied") return;
    const timer = setTimeout(() => setResult(null), COPIED_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const copy = async () => {
    try {
      // `navigator.clipboard` 가 없으면(보안 컨텍스트가 아닌 주소) 여기서 던진다.
      await navigator.clipboard.writeText(id);
      setResult({ status: "copied" });
    } catch {
      setResult({ status: "failed" });
    }
  };
  const dismiss = () => setResult(null);
  const resultText =
    result?.status === "copied"
      ? t("copied")
      : result?.status === "failed"
        ? t("failed")
        : null;

  return (
    <span className="relative inline-flex shrink-0">
      <TooltipProvider delayDuration={200}>
        <Tooltip
          open={hoverOpen || result !== null}
          onOpenChange={setHoverOpen}
        >
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground"
              aria-label={t("label")}
              onClick={() => void copy()}
              data-testid={testId}
            >
              {result?.status === "copied" ? (
                <CheckIcon aria-hidden />
              ) : (
                <CopyIcon aria-hidden />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent
            onEscapeKeyDown={dismiss}
            onPointerDownOutside={dismiss}
          >
            <span className="flex flex-col gap-0.5">
              <code className="font-mono break-all select-all">{id}</code>
              <span
                className={
                  result?.status === "failed" ? undefined : "opacity-70"
                }
              >
                {resultText ?? t("hint")}
              </span>
            </span>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {/* 툴팁은 열릴 때 새로 붙어 읽히지 않을 수 있어, 결과는 늘 붙어 있는 자리로 따로 알린다. */}
      <span role="status" className="sr-only">
        {resultText}
      </span>
    </span>
  );
}
