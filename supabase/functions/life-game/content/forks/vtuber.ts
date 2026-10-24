// 유진 키우기 갈림길 — 버튜버 루트.
import type { Fork } from "../../engine.ts";
import { R, dice, dono, fameUp, fx, neru, pick, vtJob } from "../util.ts";
import { SHOWS } from "../world.ts";

export const vtuberForks: Fork[] = [
  {
    id: "vt_concept", a: [14, 100], mile: true, now: true, tag: "데뷔", t: "버튜버 데뷔를 앞두고 있다. 어떤 모습으로 첫인사를 할까?",
    if: vtJob,
    opts: [
      pick("늑대 컨셉으로 간다", R("늑대 귀와 꼬리를 단 아바타로 첫인사를 했다. '아우~' 소리가 생각보다 잘 나왔다.", fx({ talent: 2, happy: 3 }, 0, { add: ["vt_wolf"] }), true), { hint: "늑대 전용 이벤트" }),
      pick("팀에 들어가서 데뷔한다", R("팀 합동 데뷔 방송. 잔뜩 긴장한 채 '팀의 바지 사장, 바지 알파입니다!'라고 인사해버렸다. 그날부터 별명은 바지 알파.", fx({ charm: 2, happy: 2 }, 0, { add: ["vt_team", "baji"], fn: fameUp(4) }), true), { hint: "인지도 조금 ↑ · 별명이 생겨요" }),
      pick("나답게 간다", R("특별한 컨셉 없이 평소 말투 그대로 첫 방송을 켰다.", fx({ happy: 4, charm: 1 }, 0, { add: ["vt_plain"] })), { hint: "행복 ↑" }),
    ],
  },
  {
    id: "vt_show", a: [14, 100], mile: true, rep: 3, tag: "방송",
    t: (c) => (c.s.show ? "방송 개편 시즌이다. 주력 컨텐츠를 바꿔볼까?" : "이제 주력 컨텐츠를 정할 때다. 어떤 방송을 메인으로 할까?"),
    if: (c) => vtJob(c) && c.s.seen["vt_concept"] !== undefined && c.age > c.s.seen["vt_concept"],
    opts: SHOWS.map((sh) => pick(sh.name, R(`앞으로는 ${sh.name} 위주로 방송하기로 했다.`, { fn: (c) => (c.s.show = sh.id) }), { hint: sh.hint })),
  },
  {
    id: "vt_first_dono", a: [14, 100], mile: true, tag: "첫 후원", t: "갓 데뷔한 유진의 방송. 아직 후원 알림이 한 번도 울린 적이 없다. 첫 후원을 해줄까?",
    if: (c) => vtJob(c) && c.s.seen["vt_concept"] !== undefined && c.age > c.s.seen["vt_concept"],
    opts: [
      dono(100, R("후원 알림이 처음으로 울렸다. 유진이 '어? 어?' 하다가 의자에서 떨어질 뻔했다.", fx({ happy: 5 }, 0, { add: ["first_dono"], fn: fameUp(3) }), true)),
      dono(300, R("첫 후원 알림에 유진이 한참 말을 잇지 못했다. 다시보기로 세 번이나 돌려 봤다.", fx({ happy: 7, charm: 1 }, 0, { add: ["first_dono"], fn: fameUp(6) }), true)),
      dono(500, R("첫 후원부터 500P! 유진이 방송이 끝날 때까지 그 닉네임을 불렀다.", fx({ happy: 9, charm: 2 }, 0, { add: ["first_dono"], fn: fameUp(10) }), true)),
      pick("지켜보기만 한다", R("며칠 뒤 다른 시청자가 첫 후원을 했다. 유진이 소리를 질렀다.", fx({ happy: 3 }, 0, { fn: fameUp(1) }))),
    ],
  },
  {
    id: "vt_birthday", a: [15, 100], rep: 3, w: 40, tag: "생일 방송", t: (c) => `${c.age}번째 생일 방송. 채팅창이 축하 메시지로 가득하다.`,
    if: (c) => vtJob(c) && c.s.fame >= 5,
    opts: [
      dono(100, R("축하 후원 알림이 울렸다. 유진이 케이크 앞에서 수줍게 웃었다.", fx({ happy: 4 }, 0, { fn: fameUp(2) }))),
      dono(300, R("축하 후원이 이어졌다. 유진이 '내년에도 같이 해요'라고 약속했다.", fx({ happy: 6, charm: 1 }, 0, { fn: fameUp(4) }))),
      dono(500, R("통 큰 축하 후원에 유진이 촛불을 끄다 말고 울컥했다. 레전드 생일 방송으로 남았다.", fx({ happy: 8, charm: 2 }, 0, { fn: fameUp(6) }), true)),
      pick("축하 채팅만 친다", R("축하 채팅을 하나하나 읽어주느라 방송이 한 시간 늘어났다.", fx({ happy: 3 }))),
    ],
  },
  {
    id: "vt_cheer", a: [14, 100], mile: true, rep: 2, tag: "응원", t: "요즘 유진의 방송에 힘이 없다. 끝인사 목소리가 유난히 작았다.",
    if: (c) => vtJob(c) && c.has("vt_down"),
    opts: [
      dono(100, R("응원 후원 알림에 유진이 잠깐 말을 멈췄다. '…고마워요.'", fx({ happy: 6, health: 1 }, 0, { del: ["vt_down"] }))),
      dono(300, R("응원 후원이 이어지자 유진의 목소리에 다시 힘이 들어갔다.", fx({ happy: 9, health: 2 }, 0, { del: ["vt_down"], fn: fameUp(2) }))),
      dono(500, R("큰 응원 후원에 유진이 결국 웃음을 터뜨렸다. 그날 방송은 평소보다 한 시간 더 길었다.", fx({ happy: 12, health: 3, charm: 1 }, 0, { del: ["vt_down"], fn: fameUp(4) }), true)),
      pick("채팅으로 응원만 보낸다", R("응원 채팅을 보며 유진은 조금씩 힘을 냈다.", fx({ happy: 3 }, 0, { del: ["vt_down"] }))),
    ],
  },
  {
    id: "vt_million", a: [14, 100], mile: true, tag: "축하 방송", t: "팔로워 100만 축하 방송! 네루들이 전부 모였다.",
    if: (c) => vtJob(c) && c.has("gold_button"),
    opts: [
      dono(100, R("축하 후원 알림 사이로 유진이 연신 고개를 숙였다.", fx({ happy: 5, charm: 1 }))),
      dono(300, R("후원 알림이 끊이지 않았다. 유진이 '이게 다 네루 덕분'이라고 몇 번이나 말했다.", fx({ happy: 7, charm: 2 }, 0, { fn: fameUp(2) }))),
      dono(500, R("축하 후원이 쏟아져서 알림이 30분 동안 멈추지 않았다.", fx({ happy: 9, charm: 3 }, 0, { fn: fameUp(3) }), true)),
      pick("축하 채팅만 친다", R("채팅창이 축하 메시지로 꽉 찼다.", fx({ happy: 4 }))),
    ],
  },
  {
    id: "vt_comeback", a: [14, 100], rep: 4, w: 30, tag: "방송", t: "'무능 알파' 소리를 들은 지도 오래다. 오늘은 진짜 실력을 보여줄 차례.",
    if: (c) => vtJob(c) && c.has("yuneung_mock") && !c.has("yuneung_real"),
    opts: [
      dice("정면 승부한다", "talent", {
        great: R("노데스 클리어! 채팅창이 처음으로 '유능 알파'로 가득 찼다.", fx({ happy: 8, talent: 2 }, 0, { add: ["yuneung_real"], fn: fameUp(10) }), true),
        good: R("끝내 깼다. 오늘만큼은 '무능 알파'가 아니라 '유능 알파'였다.", fx({ happy: 5 }, 0, { add: ["yuneung_real"], fn: fameUp(5) })),
        bad: R("또 죽었다. '무능 알파'가 다시 도배됐다.", fx({ happy: -2 }, 0, { fn: fameUp(1) })),
      }),
      pick("오늘은 저챗이나 하자", R("게임은 다음에 하기로 했다.", fx({ happy: 1 }))),
    ],
  },
  {
    id: "vt_graduate", a: [38, 100], rep: 4, w: 35, tag: "졸업",
    t: (c) => (c.age < 55 ? "요즘 방송이 예전 같지 않다. 슬슬 졸업 방송을 생각해볼까?" : "목소리도 체력도 예전 같지 않다. 이제 졸업할 때가 된 걸까?"),
    if: (c) => vtJob(c),
    opts: [
      pick("졸업 방송을 한다", R((c) => `마지막 방송. ${neru(c)}들의 채팅이 끝도 없이 올라왔다. '그동안 고마웠어요.'`, fx({ happy: 6 }, 0, { add: ["vt_farewell", "vt_graduated"], fn: (c) => c.quit("졸업한 버튜버") }), true), { hint: "버튜버 은퇴" }),
      pick("종합 게임 스트리머로 전향한다", R((c) => `${c.has("vt_wolf") ? "늑대 아바타를 내려놓고" : "아바타를 내려놓고"} 종합 게임 스트리머로 새 출발했다. ${neru(c)}들 대부분이 따라왔다.`, fx({ happy: 4 }, 0, { add: ["vt_farewell", "vt_graduated", "vt_convert", "game"], fn: (c) => { const f = c.s.fame; c.hire("streamer"); c.s.fame = Math.round(f * 0.75); } }), true), { hint: "인지도 일부를 들고 감 · 나이 부담 없음" }),
      pick("얼굴 공개 유튜버로 전향한다", R((c) => `얼굴을 공개하고 유튜버로 새 출발했다. 첫 영상 댓글창이 '목소리랑 똑같다'로 가득했다.`, fx({ happy: 4, charm: 2 }, 0, { add: ["vt_farewell", "vt_graduated", "vt_convert"], fn: (c) => { const f = c.s.fame; c.hire("youtuber"); c.s.fame = Math.round(f * 0.7); } }), true), { hint: "인지도 일부를 들고 감 · 나이 부담 없음" }),
      pick("아직은 더 한다", R("마이크 앞에 다시 앉았다. 아직 할 말이 많다.", fx({ health: -1 })), { hint: "나이가 들수록 인지도가 조금씩 빠져요" }),
    ],
  },
  {
    id: "vt_grad_dono", a: [14, 100], rep: 1, now: true, tag: "졸업 방송", t: "버튜버 유진으로서의 마지막 방송. 마지막 후원을 보낼까?",
    if: (c) => c.has("vt_farewell"),
    opts: [
      dono(100, R("마지막 후원 알림이 울렸다. 유진이 닉네임을 천천히 읽어줬다.", fx({ happy: 4 }, 0, { del: ["vt_farewell"] }))),
      dono(300, R("마지막 후원에 유진이 끝내 목이 메었다. '진짜 마지막까지 고마워요.'", fx({ happy: 6 }, 0, { del: ["vt_farewell"] }))),
      dono(500, R("마지막 방송의 마지막 후원. 유진이 한참 동안 아무 말도 못 했다. 그 장면은 오래도록 회자됐다.", fx({ happy: 8 }, 0, { del: ["vt_farewell"] }), true)),
      pick("채팅으로 인사만 한다", R("'수고했어요' 채팅이 화면을 가득 채웠다.", fx({ happy: 3 }, 0, { del: ["vt_farewell"] }))),
    ],
  },
];
