import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InstructStructuredLabels {
  /** `null` 값. */
  nullValue: string;
  /** 빈 문자열. */
  emptyText: string;
  /** 빈 배열. */
  emptyList: string;
  /** 빈 객체. */
  emptyObject: string;
}

export type InstructStructuredProps = Omit<
  ComponentProps<"div">,
  "children" | "ref"
> & {
  /** JSON 출력 값(객체·배열·문자열·숫자·불리언·`null`). */
  value: unknown;
  /** 문자열 값을 그린다(이 앱은 markdown + 인용 칩). */
  renderText: (text: string) => ReactNode;
  /** 숫자·불리언 등 그 밖의 값 표기. 호출자의 JSON 표현(큰 정수 원문 등)을 따른다. */
  formatScalar: (value: unknown) => string;
  /** 필드 이름 + 값으로 그릴 객체인지. 호출자가 숫자를 객체로 들고 있으면 그것을 빼고 판별한다. */
  isRecord: (value: unknown) => value is Record<string, unknown>;
  labels: InstructStructuredLabels;
  /** 루트 `data-testid`. */
  testId?: string;
};

type StructuredValueProps = Pick<
  InstructStructuredProps,
  "renderText" | "formatScalar" | "isRecord" | "labels"
> & { value: unknown; depth: number };

/**
 * `response_format` 으로 받은 JSON 출력을 필드별로 보인다. 객체는 필드 이름 + 값, 배열은 번호 목록,
 * 문자열은 `renderText` 로 그려 본문과 같이 인용 칩이 살아 있다. 나머지 `div` props 는 루트로.
 */
export function InstructStructured({
  value,
  renderText,
  formatScalar,
  isRecord,
  labels,
  testId,
  className,
  ...props
}: InstructStructuredProps) {
  return (
    <div
      {...props}
      className={cn("min-w-0 text-sm", className)}
      data-testid={testId}
    >
      <StructuredValue
        value={value}
        renderText={renderText}
        formatScalar={formatScalar}
        isRecord={isRecord}
        labels={labels}
        depth={0}
      />
    </div>
  );
}

function StructuredValue({
  value,
  renderText,
  formatScalar,
  isRecord,
  labels,
  depth,
}: StructuredValueProps): ReactNode {
  const child = (item: unknown) => (
    <StructuredValue
      value={item}
      renderText={renderText}
      formatScalar={formatScalar}
      isRecord={isRecord}
      labels={labels}
      depth={depth + 1}
    />
  );
  if (value === null) return <Muted>{labels.nullValue}</Muted>;
  if (typeof value === "string") {
    return value.trim() === "" ? (
      <Muted>{labels.emptyText}</Muted>
    ) : (
      renderText(value)
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <Muted>{labels.emptyList}</Muted>;
    return (
      <ol className="my-0 flex list-decimal flex-col gap-1.5 pl-5 marker:text-muted-foreground">
        {value.map((item: unknown, index) => (
          <li key={index} className="min-w-0 pl-1">
            {isRecord(item) ? (
              <div className="rounded-md border border-border p-2">
                {child(item)}
              </div>
            ) : (
              child(item)
            )}
          </li>
        ))}
      </ol>
    );
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return <Muted>{labels.emptyObject}</Muted>;
    return (
      <dl className="flex min-w-0 flex-col gap-2">
        {entries.map(([key, item]) => (
          <div
            key={key}
            className={cn(
              "flex min-w-0 flex-col gap-0.5",
              depth > 0 && "border-l-2 border-border pl-2",
            )}
          >
            <dt className="text-xs font-medium text-muted-foreground">{key}</dt>
            <dd className="min-w-0">{child(item ?? null)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  // 숫자·불리언(큰 숫자는 호출자 표기 그대로).
  return <span className="tabular-nums">{formatScalar(value)}</span>;
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-muted-foreground">{children}</span>;
}
