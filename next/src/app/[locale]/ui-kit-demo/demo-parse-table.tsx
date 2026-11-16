"use client";

import { useState } from "react";
import {
  ParseTable,
  type ParseTableLabels,
} from "@/components/studio-ui-kit/parse-table";
import { PARSE_TABLE_HTML } from "./demo-data";
import { Section, StateLine, TEST_ID } from "./demo-section";

// `image` 의 identity 가 바뀌면 다시 파싱하므로 모듈 상수로 고정한다.
const PARSE_LABELS: ParseTableLabels = {
  region: "Table",
  image: alt => `(Image: ${alt})`,
};

export function ParseTableDemo() {
  const [activations, setActivations] = useState(0);
  return (
    <Section
      title="parse-table"
      description="A Parse table element's HTML rebuilt from an allow list: merged cells stay, the picture becomes alt text, and script, iframe, inline handlers and styles are dropped. Without an id the callbacks get no argument; clicking the table counts activations."
      testId={`${TEST_ID}-parse-table-section`}
    >
      <ParseTable
        html={PARSE_TABLE_HTML}
        labels={PARSE_LABELS}
        onActivate={() => setActivations(count => count + 1)}
        testId={`${TEST_ID}-parse-table`}
      />
      <StateLine testId={`${TEST_ID}-parse-table-activations`}>
        {`activations: ${activations}`}
      </StateLine>
    </Section>
  );
}
