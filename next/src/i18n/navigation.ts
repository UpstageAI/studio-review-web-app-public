import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

// next/link, next/navigation 대신 사용 — 현재 locale prefix 를 자동으로 붙인다.
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
