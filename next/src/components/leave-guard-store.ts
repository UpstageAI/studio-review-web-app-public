"use client";

import { useEffect } from "react";
import { confirmLeave } from "@/lib/leave-confirm";

/**
 * 검수 화면의 "저장하지 않은 변경" 을 화면 밖(공통 상단 바의 처음 화면 링크, 설정 메뉴의 언어 바꾸기)에서
 * 알 수 있게 하는 작은 모듈 저장소. 검수 화면 머리가 지금 상태를 올려 두고 사라질 때 지운다. 같은 탭
 * 안에서만 쓰고 저장하지 않는다.
 */
export interface LeaveGuard {
  /** 저장하지 않은 변경이 있거나 저장 중이다. */
  dirty: boolean;
  /** 떠날지 물을 때 보일 문구. */
  message: string;
}

let current: LeaveGuard | null = null;

export function getLeaveGuard(): LeaveGuard | null {
  return current;
}

/** 지금 상태를 올린다. 돌려준 함수는 이 상태가 아직 최신일 때만 지운다. */
export function publishLeaveGuard(guard: LeaveGuard): () => void {
  current = guard;
  return () => {
    if (current === guard) current = null;
  };
}

/** 떠나기 전에 물어야 하는가(올려 둔 상태에 변경이 있다). 링크가 기본 이동을 막을지 바로 정할 때 쓴다. */
export function needsLeaveConfirm(): boolean {
  return current?.dirty ?? false;
}

/** 올려 둔 상태에 변경이 있으면 떠날지 묻는다. 떠나도 되면 `true`. */
export function confirmAppLeave(): Promise<boolean> {
  return current === null
    ? Promise.resolve(true)
    : confirmLeave(current.dirty, current.message);
}

/** 마운트된 동안 이 화면의 변경 상태를 올려 두고, 사라지면 지운다. */
export function usePublishLeaveGuard(dirty: boolean, message: string): void {
  useEffect(() => publishLeaveGuard({ dirty, message }), [dirty, message]);
}
