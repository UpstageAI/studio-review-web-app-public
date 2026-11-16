import type { FilePagesResponse } from "./types";

/**
 * 뷰어에 그릴 준비가 됐는가. 파일이 `READY` 거나, 상태와 관계없이 모든 페이지에 이미지가 있으면
 * 준비된 것으로 본다. Collection 이 복사해 둔 파일은 `UPLOADED` 상태로 남지만 페이지 이미지는
 * 있어서, 상태만 보면 영영 "준비 중" 이 된다.
 */
export function filePagesReady(response: FilePagesResponse): boolean {
  if (response.status === "READY") return true;
  return (
    response.pages.length > 0 &&
    response.pages.every(page => page.image_url !== null)
  );
}
