import type { Locale } from "./config";
import type messages from "../messages/en.json";

// 메시지 키 / locale 타입 체크 (en.json 이 기준)
declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
