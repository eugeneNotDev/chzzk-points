// 유진 키우기 v3 — 서버 엔진에서 쓰는 타입. 화면 쪽(web/src/lib/life.ts)도 같은 모양을 씀.
// 돈은 전부 "만원" 단위 정수(1 = 1만원). 포인트로 살 때는 1만원 = 1P.

export type StatKey = "health" | "intel" | "charm" | "happy" | "talent";
export type Stats = Record<StatKey, number>;
export const STAT_KEYS: StatKey[] = ["health", "intel", "charm", "happy", "talent"];
export const STAT_LABEL: Record<StatKey, string> = { health: "건강", intel: "지능", charm: "매력", happy: "행복", talent: "끼" };

export type HouseId = "poor" | "normal" | "comfy" | "rich";
export type Role = "mom" | "dad" | "friend" | "partner" | "spouse" | "child" | "pet";
export type Person = {
  id: number;
  role: Role;
  name: string;
  born: number; // 유진 나이 기준 태어난 해(부모는 음수)
  bond: number; // 0~100
  alive: boolean;
  since: number; // 만난(이 관계가 된) 유진 나이
};
export type Asset = { id: string; name: string; value: number; kind: "home" | "car" | "thing"; age: number };
export type Fund = "deposit" | "bond" | "stock" | "coin";
export type Tier = "great" | "good" | "normal" | "bad" | "terrible";
export type Roll = { dice: [number, number]; mod: number; total: number; tier: Tier; stat: StatKey | null };

// 기록 한 줄. k: 종류, t: 글, d: 능력치 변화, m: 돈 변화(만원), roll: 주사위
export type Kind =
  | "life" | "day" | "rare" | "fork" | "pick" | "job" | "money" | "people" | "buy" | "think" | "sick" | "end" | "school";
export type Entry = { age: number; k: Kind; t: string; d?: Partial<Stats>; m?: number; roll?: Roll; hl?: boolean };

export type PendingOpt = {
  key: string;
  i: number; // 콘텐츠 옵션 번호
  text: string;
  hint?: string;
  cost?: number; // 필요한 돈(만원)
  roll?: StatKey | null; // 주사위 굴리는 선택이면 어떤 능력치로
  mod?: number; // 그 주사위 보정
  off?: string; // 못 고르는 이유(돈 부족 등)
  arg?: string;
  pts?: number; // 포인트로 후원하는 선택이면 그 금액(P)
};
export type Pending = { id: string; kind: "fork" | "mile" | "think" | "focus"; tag?: string; text: string; opts: PendingOpt[] };

export type Sick = { id: string; name: string; sev: number; since: number };

export type Ending = {
  title: string;
  mod: string | null;
  modId: string | null;
  job: string;
  jobId: string;
  cause: "old" | "sick" | "accident";
  causeText: string;
  age: number;
  specialId: string | null;
  specialText: string | null;
  mourners: number;
  netWorth: number;
  earned: number;
  peak: number;
};

export type State = {
  v: 3;
  age: number;
  house: HouseId;
  stats: Stats;
  // 돈(만원)
  cash: number;
  invest: number;
  fund: Fund;
  debt: number;
  assets: Asset[];
  earned: number; // 평생 번 돈
  peak: number; // 최고 순자산
  income: number; // 지난해 수입
  expense: number; // 지난해 지출
  ret: number; // 지난해 투자 수익
  // 일·학교
  job: string | null;
  jobSince: number;
  salary: number;
  jobs: { id: string; name: string; age: number }[];
  edu: "none" | "high" | "local" | "inseoul" | "top" | "grad";
  school: string; // 지금 상태 글(예: "고등학생", "취준생")
  score: string | null; // 수능 결과
  until: number; // 학교가 끝나는 나이
  rank?: number; // 지금 직업 안에서의 등급(0부터)
  rankSince?: number; // 그 등급이 된 나이
  fame: number; // 방송·창작 인지도 0~100
  biz: number; // 가게 경기 0~100
  army: number; // 남은 군 복무 해
  focus: string;
  flags: string[];
  seen: Record<string, number>; // 이벤트 id → 마지막으로 나온 나이
  people: Person[];
  pid: number;
  sick: Sick | null;
  luck: number;
  pending: Pending | null;
  hist: number[][]; // [나이, 건강, 지능, 매력, 행복, 끼, 순자산]
  thoughts: { age: number; q: string; a: string }[];
  pointsUsed: number;
  donated?: number; // 이번 판에서 포인트로 후원한 합계(P)
  show?: string; // 버튜버의 주력 컨텐츠(content.ts SHOWS)
  dead: { cause: "old" | "sick" | "accident"; age: number; why?: string } | null; // why: 구체적인 사인(급성 심근경색, 교통사고 …)
  ending: Ending | null;
};

// 집 담보대출을 뺀 빚 — 집값만큼은 갚을 수 있는 빚으로 봄(파산 판정·빚 스트레스에 씀)
export function badDebt(s: State) {
  const home = s.assets.reduce((a, x) => a + (x.kind === "home" ? x.value : 0), 0);
  return Math.max(0, s.debt - home);
}
