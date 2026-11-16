"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  ValueWidget as CoreValueWidget,
  type ValueWidgetControlProps,
  type ValueWidgetLabels,
} from "@/components/studio-ui-kit/value-widget";
import type { JsonValue, Widget } from "@/lib/review-model";
import { formatBytes } from "@/lib/format";
import { focusNextField } from "./value-fields";
import { jsonValueCodec, toValueWidgetDescriptor } from "./value-widget-codec";

/** 값 패널의 다음 칸 이동(`focusNextField`)과 포커스 예약이 찾는 입력 요소 표식. */
const FIELD_INPUT_PROPS: ValueWidgetControlProps = { "data-field-input": "" };

export interface ValueWidgetProps {
  id: string;
  widget: Widget;
  value: JsonValue;
  disabled: boolean;
  /** 행에 오류가 있다(`aria-invalid`). */
  invalid?: boolean;
  /** 오류 문구 id(`aria-describedby`). */
  describedBy?: string;
  /** 값이 바뀌어 확정될 때(blur·Enter·선택). 같은 값이면 부르지 않는다. */
  onCommit: (value: JsonValue) => void;
  /** 입력 오류(숫자 형식 등)를 행에 알린다. `null` 은 오류 없음. */
  onError: (message: string | null) => void;
  /** 결과 전체를 JSON 으로 고치는 대화 상자를 연다(긴 문자열 요약의 버튼). 없으면 버튼을 숨긴다. */
  onEditJson?: () => void;
  /** 입력 요소(입력칸, 선택 상자)에 더할 클래스. 표 셀처럼 좁은 자리에서 모양을 줄일 때. */
  controlClassName?: string;
  testId: string;
}

/**
 * schema 위젯 종류별 입력. 문구·값 변환·다음 칸 이동을 이 앱 것으로 채워 Core 값 위젯을 그린다.
 * Enter 로 확정하면 값 패널 안 다음 입력으로 포커스를 옮긴다.
 */
export function ValueWidget({ widget, ...props }: ValueWidgetProps) {
  const labels = useValueWidgetLabels();
  return (
    <CoreValueWidget<JsonValue>
      {...props}
      descriptor={toValueWidgetDescriptor(widget)}
      codec={jsonValueCodec}
      labels={labels}
      onSubmitNext={focusNextField}
      controlProps={FIELD_INPUT_PROPS}
    />
  );
}

function useValueWidgetLabels(): ValueWidgetLabels {
  const t = useTranslations("review.values");
  const tl = useTranslations("review.values.longText");
  const tt = useTranslations("review.values.tree");
  const locale = useLocale();
  return useMemo(
    () => ({
      none: t("none"),
      true: t("true"),
      false: t("false"),
      nullPlaceholder: t("nullPlaceholder"),
      emptyPlaceholder: t("emptyPlaceholder"),
      notInConfig: value => t("notInConfig", { value }),
      errors: {
        invalid_number: t("invalid_number"),
        not_integer: t("not_integer"),
        invalid_json: t("invalid_json"),
        not_scalar: t("not_scalar"),
      },
      longTextSummary: (bytes, count) =>
        tl("summary", { size: formatBytes(bytes, locale) ?? "", count }),
      longTextHint: tl("hint"),
      editJson: tt("editJson"),
    }),
    [t, tl, tt, locale],
  );
}
