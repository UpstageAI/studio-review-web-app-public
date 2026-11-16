"use client";

import { useCallback, useState } from "react";
import {
  InstructCitations,
  InstructMarkdown,
  InstructStructured,
  type CitationState,
  type InstructMarkdownLabels,
  type InstructStructuredLabels,
} from "@/components/studio-ui-kit/instruct-markdown";
import { Skeleton } from "@/components/ui/skeleton";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  INSTRUCT_NO_LOCATION,
  INSTRUCT_STRUCTURED,
  INSTRUCT_TEXT,
} from "./demo-data";
import { Section, StateLine, TEST_ID } from "./demo-section";

const MARKDOWN_LABELS: InstructMarkdownLabels = {
  citation: index => `Citation ${index}`,
  noLocation: "No location information",
  image: alt => `(Image: ${alt})`,
};

const STRUCTURED_LABELS: InstructStructuredLabels = {
  nullValue: "None",
  emptyText: "(empty)",
  emptyList: "No items",
  emptyObject: "No fields",
};

const FALLBACK = <Skeleton className="h-16 w-full" />;

const formatScalar = (value: unknown) => JSON.stringify(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const renderText = (text: string) => (
  <InstructMarkdown text={text} fallback={FALLBACK} />
);

export function InstructMarkdownDemo() {
  const [selected, setSelected] = useState<number | null>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const getCitationState = useCallback(
    (index: number): CitationState => ({
      disabled: index === INSTRUCT_NO_LOCATION,
      selected: index === selected,
    }),
    [selected],
  );

  return (
    <Section
      title="instruct-markdown"
      description="Instruct output markdown. Inside InstructCitations the citation markers become chips (click selects, hover previews; chip 3 has no location and only shows a tooltip). Without the provider the same text renders with the markers removed. InstructStructured renders a JSON output field by field with the same chips in its strings."
      testId={`${TEST_ID}-instruct-section`}
    >
      {/* 위치 없는 칩의 툴팁은 조상 TooltipProvider 가 필요하다. */}
      <TooltipProvider delayDuration={200}>
        <InstructCitations
          getCitationState={getCitationState}
          onCitationSelect={setSelected}
          onCitationHover={setHovered}
          labels={MARKDOWN_LABELS}
          testId={`${TEST_ID}-instruct`}
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-sm font-semibold">With citations</h3>
              <InstructMarkdown
                text={INSTRUCT_TEXT}
                fallback={FALLBACK}
                data-testid={`${TEST_ID}-instruct-with-citations`}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <h3 className="text-sm font-semibold">Structured output</h3>
              <InstructStructured
                value={INSTRUCT_STRUCTURED}
                renderText={renderText}
                formatScalar={formatScalar}
                isRecord={isRecord}
                labels={STRUCTURED_LABELS}
                testId={`${TEST_ID}-instruct-structured`}
              />
            </div>
          </div>
        </InstructCitations>
        <StateLine testId={`${TEST_ID}-instruct-state`}>
          {`selected: ${selected ?? "none"} · hovered: ${hovered ?? "none"}`}
        </StateLine>
        <div className="flex min-w-0 flex-col gap-2">
          <h3 className="text-sm font-semibold">Without InstructCitations</h3>
          <InstructMarkdown
            text={INSTRUCT_TEXT}
            fallback={FALLBACK}
            data-testid={`${TEST_ID}-instruct-plain`}
          />
        </div>
      </TooltipProvider>
    </Section>
  );
}
