import { describe, expect, it } from "vitest";

import {
  KNOWN_SOURCE_TYPES,
  sourceTypeKey,
  workflowName,
} from "../source-label";

describe("sourceTypeKey", () => {
  it.each(KNOWN_SOURCE_TYPES)("%s 는 그대로 키가 된다", type => {
    expect(sourceTypeKey(type)).toBe(type);
  });

  it("모르는 값은 null", () => {
    expect(sourceTypeKey("docchat")).toBeNull();
    expect(sourceTypeKey("something_new")).toBeNull();
  });

  it("없거나 빈 값은 null", () => {
    expect(sourceTypeKey(null)).toBeNull();
    expect(sourceTypeKey(undefined)).toBeNull();
    expect(sourceTypeKey("")).toBeNull();
  });

  it("대소문자를 바꾸지 않는다", () => {
    expect(sourceTypeKey("Agent_Export")).toBeNull();
    expect(sourceTypeKey("FILE_UPLOAD")).toBeNull();
  });
});

describe("workflowName", () => {
  it("agent_export·agent_link 는 label 이 workflow 이름이다", () => {
    expect(workflowName({ type: "agent_export", label: "Invoice" })).toBe(
      "Invoice",
    );
    expect(workflowName({ type: "agent_link", label: "Receipt" })).toBe(
      "Receipt",
    );
  });

  it("다른 출처의 label 은 workflow 이름이 아니다", () => {
    expect(workflowName({ type: "standalone", label: "My store" })).toBeNull();
    expect(workflowName({ type: "result_import", label: "x" })).toBeNull();
    expect(workflowName({ type: "file_upload", label: "a.csv" })).toBeNull();
  });

  it("출처나 label 이 없으면 null", () => {
    expect(workflowName(null)).toBeNull();
    expect(workflowName(undefined)).toBeNull();
    expect(workflowName({ type: "agent_export" })).toBeNull();
    expect(workflowName({ type: "agent_export", label: "" })).toBeNull();
  });
});
