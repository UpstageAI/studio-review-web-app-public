import { cn } from "@/lib/utils";

/*
 * 홈 소개 카드에 들어가는 화면 미니 프리뷰.
 * 실제 화면을 단순화한 장식 그림이므로 보조 기술에서는 숨기고, 색은 시맨틱 토큰만 쓴다.
 */

const frame =
  "h-40 overflow-hidden rounded-lg border border-border bg-muted/40 p-4";

function Bar({ className }: { className?: string }) {
  return <span className={cn("block h-2 rounded-full", className)} />;
}

/** Collection 목록: 헤더 줄 + 행 3 개 + 페이지 번호 버튼 */
export function CollectionsPreview({ className }: { className?: string }) {
  const rows = ["w-24", "w-16", "w-20"];
  return (
    <div aria-hidden className={cn(frame, "flex flex-col gap-2", className)}>
      <div className="flex items-center gap-3 border-b border-border pb-2">
        <Bar className="w-14 bg-foreground/25" />
        <Bar className="w-10 bg-foreground/25" />
        <Bar className="ml-auto w-8 bg-foreground/25" />
      </div>
      {rows.map(width => (
        <div key={width} className="flex items-center gap-3 py-0.5">
          <Bar className={cn(width, "bg-foreground/15")} />
          <span className="size-2 shrink-0 rounded-full bg-primary/60" />
          <Bar className="ml-auto w-6 bg-foreground/15" />
        </div>
      ))}
      <div className="mt-auto flex justify-center gap-1">
        {[0, 1, 2, 3, 4].map(page => (
          <span
            key={page}
            className={cn(
              "size-4 rounded-sm border",
              page === 0
                ? "border-primary bg-primary"
                : "border-border bg-background",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** Job 목록: 검색창 + 토글 2 개 + 상태 칩이 붙은 행 3 개 */
export function JobsPreview({ className }: { className?: string }) {
  const rows = ["w-20", "w-28", "w-16"];
  return (
    <div aria-hidden className={cn(frame, "flex flex-col gap-2.5", className)}>
      <div className="flex h-6 items-center gap-2 rounded-md border border-border bg-background px-2">
        <span className="size-2.5 shrink-0 rounded-full border border-foreground/30" />
        <Bar className="w-16 bg-foreground/15" />
      </div>
      <div className="flex gap-3">
        {[true, false].map(on => (
          <span key={String(on)} className="flex items-center gap-1.5">
            <span
              className={cn(
                "flex h-3 w-5 items-center rounded-full p-0.5",
                on ? "justify-end bg-primary" : "bg-foreground/20",
              )}
            >
              <span className="size-2 rounded-full bg-background" />
            </span>
            <Bar className="w-8 bg-foreground/15" />
          </span>
        ))}
      </div>
      {rows.map(width => (
        <div key={width} className="flex items-center gap-3">
          <Bar className={cn(width, "bg-foreground/15")} />
          <span className="ml-auto h-3 w-9 rounded-full border border-primary/60 bg-primary/10" />
        </div>
      ))}
    </div>
  );
}

/** Job 검수: 하이라이트가 있는 페이지 + 폼 필드 + 저장 버튼 */
export function ReviewPreview({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn(frame, "flex gap-3", className)}>
      <div className="flex w-2/5 flex-col gap-1.5 rounded-sm border border-border bg-background p-2">
        <Bar className="h-1.5 w-3/4 bg-foreground/15" />
        <div className="rounded-sm border border-primary/60 bg-primary/10 p-1">
          <Bar className="h-1.5 w-full bg-foreground/15" />
        </div>
        <Bar className="h-1.5 w-full bg-foreground/15" />
        <Bar className="h-1.5 w-2/3 bg-foreground/15" />
        <div className="rounded-sm border border-primary/60 bg-primary/10 p-1">
          <Bar className="h-1.5 w-1/2 bg-foreground/15" />
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2">
        {["w-10", "w-14", "w-8"].map(width => (
          <div key={width} className="flex flex-col gap-1">
            <Bar className={cn("h-1.5", width, "bg-foreground/25")} />
            <span className="block h-4 rounded-sm border border-border bg-background" />
          </div>
        ))}
        <span className="mt-auto h-5 w-14 self-end rounded-md bg-primary" />
      </div>
    </div>
  );
}
