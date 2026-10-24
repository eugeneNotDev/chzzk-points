// 유진 키우기 v3 엔진 — 한 해씩 인생을 굴림. Deno/Node 어디서나 돌도록 외부 의존 없음(시뮬레이션 스크립트도 이걸 그대로 씀).
// 콘텐츠(이벤트·갈림길·직업·상점·엔딩)는 content.ts. 돈은 전부 만원 단위.
// 실제 코드는 engine/ 폴더에 단계별로 나눠 두고, 여기서는 다른 파일이 쓰던 이름 그대로 모아서 내보내기만 함.
import { STAT_LABEL } from "./types.ts";
import { josa } from "./josa.ts";

export { josa };

export { STAT_LABEL };
export type { Text, Fx, Out, Opt, Fork, Daily, Focus, Job, Item, House, Mod, Special, Disease, Show } from "./engine/shapes.ts";
export { jobTitle } from "./engine/shapes.ts";
export { fmtMoney, stageOf, statMod } from "./engine/tools.ts";
export { Ctx, netWorth } from "./engine/ctx.ts";
export { newLife } from "./engine/life.ts";
export { makePending, stepYear, advance, choose, setFocus, setFund, shopList, buy, broadcastOf, startRun } from "./engine/decision.ts";
