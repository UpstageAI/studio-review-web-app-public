"use client";

import { createContext, useContext } from "react";

export type FilmstripOpenValue = readonly [boolean, (open: boolean) => void];

export const FilmstripOpenContext = createContext<FilmstripOpenValue | null>(
  null,
);

/** 필름스트립 펼침 여부와 바꾸는 함수(`FilmstripOpenProvider` 안에서). */
export function useFilmstripOpen(): FilmstripOpenValue {
  const value = useContext(FilmstripOpenContext);
  if (!value) {
    throw new Error("useFilmstripOpen 은 FilmstripOpenProvider 안에서 쓴다");
  }
  return value;
}
