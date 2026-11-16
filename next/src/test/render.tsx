import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement } from "react";
import type { Locale } from "@/i18n/config";
import en from "@/messages/en.json";
import ja from "@/messages/ja.json";
import ko from "@/messages/ko.json";

const MESSAGES = { en, ko, ja } as const satisfies Record<Locale, unknown>;

export interface RenderWithIntlOptions extends Omit<RenderOptions, "wrapper"> {
  locale?: Locale;
}

/**
 * host 컴포넌트용 렌더 helper. 앱과 같은 번역 문구(`src/messages/*.json`)와 시간대(UTC)로
 * `NextIntlClientProvider` 를 감싼다. Studio UI Kit item 테스트(`src/test/studio-ui-kit/`)는 i18n 이 없으므로 쓰지 않는다.
 */
export function renderWithIntl(
  ui: ReactElement,
  { locale = "ko", ...options }: RenderWithIntlOptions = {},
) {
  return render(ui, {
    ...options,
    wrapper: ({ children }) => (
      <NextIntlClientProvider
        locale={locale}
        messages={MESSAGES[locale]}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    ),
  });
}
