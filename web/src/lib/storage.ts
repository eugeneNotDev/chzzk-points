// localStorage는 시크릿 창·저장 차단 브라우저에서 예외를 던질 수 있어서 전부 감싸서 씀.
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 저장 못 해도 화면엔 영향 없음 */
  }
}
