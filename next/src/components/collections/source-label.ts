// Collection 출처(`source.type`) 값을 화면 문구 키로 바꾼다.

/** 화면 문구가 있는 출처 유형. 서버가 새 유형을 보내면 원문을 그대로 보인다. */
export const KNOWN_SOURCE_TYPES = [
  "agent_export",
  "agent_link",
  "result_import",
  "file_upload",
  "standalone",
] as const;

export type KnownSourceType = (typeof KNOWN_SOURCE_TYPES)[number];

/** 아는 출처 유형이면 그 값을, 모르는 값·빈 값이면 `null` 을 돌려준다. 대소문자는 바꾸지 않는다. */
export function sourceTypeKey(
  type: string | null | undefined,
): KnownSourceType | null {
  if (!type) return null;
  return (KNOWN_SOURCE_TYPES as readonly string[]).includes(type)
    ? (type as KnownSourceType)
    : null;
}

/** `source.label` 이 workflow(Agent) 이름인 출처 유형. 다른 유형의 label 은 파일 이름·Collection 이름 등이다. */
export const WORKFLOW_SOURCE_TYPES = ["agent_export", "agent_link"] as const;

/** workflow 출처면 그 workflow 이름을, 아니거나 이름이 비면 `null` 을 돌려준다. */
export function workflowName(
  source: { type?: string | null; label?: string | null } | null | undefined,
): string | null {
  if (!source?.type || !source.label) return null;
  return (WORKFLOW_SOURCE_TYPES as readonly string[]).includes(source.type)
    ? source.label
    : null;
}
