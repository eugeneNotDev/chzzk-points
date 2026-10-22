// 한국어 조사 붙이기 — 이름 받침에 맞춰 와/과, 가/이, 를/을 등을 고름
// 한국어 조사: 앞 글자에 받침이 있으면 과/이/을/이랑/으로/아/이라고, 없으면 와/가/를/랑/로/야/라고
function batchim(w: string) {
  const ch = w.charCodeAt(w.length - 1);
  if (ch < 0xac00 || ch > 0xd7a3) return { has: false, rieul: false };
  const jong = (ch - 0xac00) % 28;
  return { has: jong !== 0, rieul: jong === 8 };
}
const JOSA: Record<string, [string, string]> = {
  와: ["과", "와"], 과: ["과", "와"], 이: ["이", "가"], 가: ["이", "가"], 은: ["은", "는"], 는: ["은", "는"],
  을: ["을", "를"], 를: ["을", "를"], 이랑: ["이랑", "랑"], 랑: ["이랑", "랑"], 아: ["아", "야"], 야: ["아", "야"],
  이라고: ["이라고", "라고"], 라고: ["이라고", "라고"],
};
export function josa(w: string, j: string) {
  const b = batchim(w);
  if (j === "로" || j === "으로") return w + (b.has && !b.rieul ? "으로" : "로");
  const pair = JOSA[j];
  return pair ? w + (b.has ? pair[0] : pair[1]) : w + j;
}
