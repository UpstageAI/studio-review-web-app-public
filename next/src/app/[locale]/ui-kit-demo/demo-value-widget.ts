import type {
  ValueWidgetCodec,
  ValueWidgetLabels,
} from "@/components/studio-ui-kit/value-widget";
import type { DemoScalar } from "./demo-data";

// 값 위젯 데모와 배열 표 데모가 함께 쓰는 문구·값 변환.

export const VALUE_LABELS: ValueWidgetLabels = {
  none: "None",
  true: "True",
  false: "False",
  nullPlaceholder: "null",
  emptyPlaceholder: "(empty)",
  notInConfig: value => `${value} (not in config)`,
  errors: {
    invalid_number: "Enter a number.",
    not_integer: "Enter a whole number.",
    invalid_json: "Enter a JSON value.",
    not_scalar: "Objects and arrays are not allowed.",
  },
  longTextSummary: (bytes, count) =>
    `${bytes.toLocaleString("en")} bytes · ${count.toLocaleString("en")} characters`,
  longTextHint: "Long text is shown as a summary.",
  editJson: "Edit as JSON",
};

const isScalar = (value: unknown): value is DemoScalar =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

/** 값 = JSON 스칼라. 같은 값이면 같은 key. */
export const CODEC: ValueWidgetCodec<DemoScalar> = {
  toText: value =>
    value === null
      ? ""
      : typeof value === "string"
        ? value
        : JSON.stringify(value),
  keyOf: value => `${typeof value}:${String(value)}`,
  equals: (a, b) => a === b,
  parseNumber(text, integer) {
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) {
      return { ok: false, reason: "invalid_number" };
    }
    if (integer && !Number.isInteger(n)) {
      return { ok: false, reason: "not_integer" };
    }
    return { ok: true, value: n };
  },
  parseScalar(text) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    return isScalar(parsed)
      ? { ok: true, value: parsed }
      : { ok: false, reason: "not_scalar" };
  },
};
