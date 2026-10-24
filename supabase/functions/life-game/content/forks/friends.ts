// 유진 키우기 갈림길 — 친구.
import type { Fork } from "../../engine.ts";
import { R, dice, fx, pick } from "../util.ts";

export const friendsForks: Fork[] = [
  {
    id: "friend_money", a: [22, 65], tag: "사람", t: "{f}가 급하게 돈을 빌려달라고 한다.", if: (c) => !!c.person("friend"),
    opts: [
      dice("빌려준다", null, {
        good: R("{f}가 1년 만에 이자까지 쳐서 갚았다.", fx({ happy: 3 }, 600, { fn: (c) => c.bond(c.person("friend"), 10) })),
        bad: R("{f}와 연락이 끊겼다.", fx({ happy: -6 }, 0, { fn: (c) => c.drop(c.person("friend")) })),
      }, { cost: 500, bonus: (c) => Math.round(((c.person("friend")?.bond ?? 50) - 50) / 15), hint: "운 주사위 · 친할수록 +" }),
      pick("거절한다", R("{f}와 조금 서먹해졌다.", fx({}, 0, { fn: (c) => c.bond(c.person("friend"), -15) }))),
    ],
  },
  {
    id: "friend_biz", a: [27, 55], tag: "사람", t: "{f}가 같이 사업을 해보자고 한다.", if: (c) => !!c.person("friend"),
    opts: [
      dice("동업한다", "intel", {
        great: R("사업이 대박 났다! 투자금이 몇 배로 돌아왔다.", fx({ happy: 8 }, 15000), true),
        good: R("쏠쏠하게 벌었다.", fx({ happy: 4 }, 4500)),
        bad: R("사업이 망했다. 투자금을 날렸다.", fx({ happy: -6 }, 0, { fn: (c) => c.bond(c.person("friend"), -20) })),
        terrible: R("사업이 망하고 {f}와도 틀어졌다.", fx({ happy: -8 }, -1000, { fn: (c) => c.drop(c.person("friend")) })),
      }, { cost: 3000 }),
      pick("거절한다", R("우정은 우정, 돈은 돈.", fx({}))),
    ],
  },
  {
    id: "friend_wedding", a: [24, 40], tag: "사람", t: "{f}가 결혼식 축가를 부탁했다.", if: (c) => !!c.person("friend"),
    opts: [
      dice("축가를 부른다", "talent", {
        great: R("하객들이 기립박수를 쳤다. 명함을 세 장 받았다.", fx({ charm: 4, happy: 5 }, 0, { fn: (c) => c.bond(c.person("friend"), 10) }), true),
        good: R("무사히 불렀다. {f}가 고마워했다.", fx({ happy: 3 }, 0, { fn: (c) => c.bond(c.person("friend"), 8) })),
        bad: R("고음에서 삑사리가 났다. 영상이 박제됐다.", fx({ happy: -3 }, 0, { fn: (c) => c.bond(c.person("friend"), 3) })),
      }),
      pick("축의금만 두둑이", R("축의금을 두둑이 냈다.", fx({}, -50, { fn: (c) => c.bond(c.person("friend"), 3) }))),
    ],
  },
];
