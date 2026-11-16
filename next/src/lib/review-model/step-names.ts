// Step 표시 이름과 타입 배지 키. Studio 가 Step 을 가져올 때(import node) 쓰는 이름 규칙과 같다.

export type StepTypeKey =
  | "parse"
  | "classify"
  | "split"
  | "extract"
  | "instruct"
  | "validate"
  | "match"
  | "merge"
  | "export";

const TYPE_KEYS: Readonly<Record<string, StepTypeKey>> = {
  parse: "parse",
  "document-parse": "parse",
  classify: "classify",
  "document-classify": "classify",
  split: "split",
  "document-split": "split",
  extract: "extract",
  "information-extract": "extract",
  instruct: "instruct",
  "instruct-generate": "instruct",
  validate: "validate",
  match: "match",
  merge: "merge",
  export: "export",
};

/** 검수 JSON·Job 응답의 Step 타입 → 배지 키. 모르는 타입은 `null`(화면이 원래 문자열을 쓴다). */
export function stepTypeKey(type: string): StepTypeKey | null {
  return Object.hasOwn(TYPE_KEYS, type) ? (TYPE_KEYS[type] ?? null) : null;
}

/** Step 을 만들 때 이름 앞에 붙는 타입별 접두사. merge·그 밖 타입은 없다. */
const NAME_PREFIXES: Readonly<Record<string, string>> = {
  "document-classify": "Classify - ",
  "information-extract": "Information Extract - ",
  instruct: "Instruct - ",
  "instruct-generate": "Instruct - ",
  validate: "Validate - ",
  export: "Export - ",
  match: "Match - ",
};

/** 자동으로 붙은 위치 이름(`step_2_classify` 등). 보여 줄 이름이 없다는 뜻이다. */
const POSITIONAL_NAME = /^step_\d+_[a-z-]+$/;

/**
 * 화면에 보일 Step 이름. `null` 이면 이름 없이 타입 배지만 보인다.
 *
 * 1. `customName` 이 공백이 아닌 문자열이면 그대로.
 * 2. 이름이 위치 이름이면 `null`.
 * 3. 타입에 맞는 접두사로 시작하면 떼고 앞뒤 공백을 지운다(남는 것이 없으면 원래 이름).
 * 4. 그 밖에는 원래 이름.
 */
export function stepDisplayName(step: {
  readonly name: string;
  readonly type: string;
  readonly customName?: string | null;
}): string | null {
  const { name, type, customName } = step;
  if (typeof customName === "string" && customName.trim() !== "") {
    return customName;
  }
  if (POSITIONAL_NAME.test(name)) return null;
  const prefix = Object.hasOwn(NAME_PREFIXES, type)
    ? NAME_PREFIXES[type]
    : undefined;
  if (prefix && name.startsWith(prefix)) {
    const rest = name.slice(prefix.length).trim();
    return rest === "" ? name : rest;
  }
  return name;
}

// Step 타입 술어. 서버 규칙과 같은 정확 일치 — 짧은 별칭(`classify`·`extract`·`parse`)은 받지 않는다.
// 검수 JSON 의 `step.type` 과 Job 응답의 `step_type` 에 함께 쓴다(응답 필드는 타입을 모르므로 `unknown`).

/** Classify Step(`document-classify`). */
export function isClassifyStepType(type: unknown): boolean {
  return type === "document-classify";
}

/** Validate Step(`validate`). */
export function isValidateStepType(type: unknown): boolean {
  return type === "validate";
}

/** Merge Step(`merge`). */
export function isMergeStepType(type: unknown): boolean {
  return type === "merge";
}

/** Information Extract Step(`information-extract`). */
export function isExtractStepType(type: unknown): boolean {
  return type === "information-extract";
}

/** Document Parse Step(`document-parse`). */
export function isParseStepType(type: unknown): boolean {
  return type === "document-parse";
}
