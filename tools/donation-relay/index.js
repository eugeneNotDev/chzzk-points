// 유진 팬보드 후원 연동 — 방송 PC에서 방송하는 동안 켜두는 프로그램.
//
// 하는 일: 치지직 공식 API로 유진님 채널의 후원 알림을 받아서, 사이트 서버(Edge Function donation-relay)로
// 그대로 넘겨줌. 적립할지 말지(1만 치즈 이상 / 익명 / 가입자 여부)는 전부 서버가 판단함.
// 이 프로그램에는 치지직 토큰이나 DB 열쇠가 없고, config.json의 "중계 비밀번호"만 있음.
//
// 흐름: 서버에 소켓 주소 요청 → 치지직 소켓 연결 → 연결되면 받은 sessionKey로 후원 구독 요청
//       → 후원(DONATION)이 오면 서버로 전달 → 연결이 끊기면 몇 초 뒤 처음부터 다시.
// 서버로 못 보낸 후원은 pending.json에 모아뒀다가 다시 보냄(같은 후원이 두 번 적립되지는 않음 — eventKey).
//
// 미션 후원 · 구독권 선물: 공식 API가 이 두 가지는 안 보내줘서, 시청자가 보는 것과 같은 치지직 채팅창에
// "읽기 전용"으로 하나 더 연결해서 받음(로그인 정보 없이 연결 — 채팅을 보낼 수는 없음).
//   - 미션: 미션이 걸리면 기록만 해두고, 유진님이 "미션 성공"을 누르면 그때 적립(실패·거절이면 치즈 환불이라 적립 없음).
//   - 구독권 선물: 선물한 사람에게 개수 × 1장 가격으로 적립(가격은 서버 donation-relay의 SUB_GIFT_PRICE).
//   - 일반 후원은 여기서 무시(공식 API 쪽에서 이미 받음 — 두 번 적립 방지).
// 받은 미션/선물 원본은 chat-events.log에 남겨둠(문제 생겼을 때 확인용, 저장소에는 안 올라감).

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const io = require("socket.io-client");

const CONFIG_PATH = path.join(__dirname, "config.json");
const PENDING_PATH = path.join(__dirname, "pending.json");
const CHAT_LOG_PATH = path.join(__dirname, "chat-events.log");
const OWNER_CHANNEL_ID = "37a1acfaa35d56311bf428dc96142e9f"; // 유진 알파 채널(공개 값)
const CHAT_NOT_LIVE_DELAY_MS = 60000;
const CHAT_PING_MS = 20000;
const CHAT_RECHECK_MS = 5 * 60 * 1000;
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const RECONNECT_DELAY_MS = 5000;
const RETRY_PENDING_MS = 15000;
const NEED_LOGIN_DELAY_MS = 60000;

function log(msg) {
  const t = new Date().toLocaleTimeString("en-GB", { hour12: false });
  console.log(`[${t}] ${msg}`);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    log("config.json이 없습니다. config.example.json을 복사해서 config.json을 만들고 비밀번호를 넣어주세요.");
    process.exit(1);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!cfg.relayUrl || !cfg.relaySecret || String(cfg.relaySecret).length < 20) {
    log("config.json의 relayUrl / relaySecret 값을 확인해주세요.");
    process.exit(1);
  }
  return cfg;
}

const cfg = loadConfig();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const won = (n) => Number(n || 0).toLocaleString("ko-KR");

async function relay(body) {
  let res;
  try {
    res = await fetch(cfg.relayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Relay-Secret": cfg.relaySecret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    const e = new Error(`서버 연결 실패 (${err.message})`);
    e.code = "network";
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(data.error || `HTTP ${res.status}`);
    e.code = data.error || `http_${res.status}`;
    throw e;
  }
  return data;
}

// 치지직 소켓 메시지는 JSON 문자열로 한두 번 감싸져 올 수 있어서, 객체가 될 때까지 풀어줌.
function parse(raw) {
  let v = raw;
  for (let i = 0; i < 3 && typeof v === "string"; i++) {
    try {
      v = JSON.parse(v);
    } catch {
      break;
    }
  }
  return v;
}

// --- 서버로 못 보낸 후원 보관 ---
let pending = [];
try {
  if (fs.existsSync(PENDING_PATH)) pending = JSON.parse(fs.readFileSync(PENDING_PATH, "utf8")) || [];
} catch {
  pending = [];
}
function savePending() {
  try {
    if (pending.length === 0) {
      if (fs.existsSync(PENDING_PATH)) fs.unlinkSync(PENDING_PATH);
    } else {
      fs.writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2));
    }
  } catch (err) {
    log(`pending.json 저장 실패: ${err.message}`);
  }
}

function describe(result, d) {
  const who = d.donatorNickname || "익명";
  const base = `후원 ${won(d.payAmount)}치즈 (${who})`;
  switch (result.status) {
    case "credited":
      return `${base} → ${won(result.points)}P 적립${result.duplicate ? " (이미 처리됨)" : ""}`;
    case "anonymous_pending":
      return `${base} → 익명이라 관리자 페이지 '후원 적립' 탭에서 확인 필요`;
    case "below_min":
      return `${base} → 1만 치즈 미만이라 적립 없음`;
    case "not_member":
      return `${base} → 사이트 미가입자라 적립 없음`;
    default:
      return `${base} → ${result.status}`;
  }
}

async function sendDonation(item) {
  if (item.body) {
    const result = await relay(item.body);
    log(item.describe ? describeChat(item.describe, result) : `처리됨: ${result.status}`);
    return;
  }
  const result = await relay({ action: "donation", eventKey: item.eventKey, donation: item.donation });
  log(describe(result, item.donation));
}

// 채팅창에서 받은 미션/선물 → 서버로. 실패하면 pending.json에 넣었다가 다시 보냄.
async function sendChatItem(body, describeText) {
  const item = { body, describe: describeText, receivedAt: new Date().toISOString() };
  try {
    await sendDonation(item);
  } catch (err) {
    log(`${describeText} 전달 실패(나중에 다시 보냄): ${err.message}`);
    pending.push(item);
    savePending();
  }
}

function describeChat(text, result) {
  switch (result.status) {
    case "credited":
      return `${text} → ${won(result.points)}P 적립${result.duplicate ? " (이미 처리됨)" : ""}`;
    case "anonymous_pending":
      return `${text} → 익명이라 관리자 페이지 '후원 적립' 탭에서 확인 필요`;
    case "below_min":
      return `${text} → 1만 치즈(원) 미만이라 적립 없음`;
    case "not_member":
      return `${text} → 사이트 미가입자라 적립 없음`;
    case "mission_pending":
      return `${text} → 기록해 둠(미션 성공하면 적립)`;
    case "mission_success":
      return `${text} → 미션 성공! ${result.credited || 0}명 ${won(result.points)}P 적립`;
    case "mission_failed":
      return `${text} → 미션 실패/거절이라 적립 없음`;
    case "already_resolved":
      return `${text} → 이미 처리된 미션`;
    default:
      return `${text} → ${result.status}`;
  }
}

async function handleDonation(raw) {
  const d = parse(raw) || {};
  const item = {
    eventKey: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    donation: {
      channelId: d.channelId,
      donatorChannelId: d.donatorChannelId,
      donatorNickname: d.donatorNickname,
      payAmount: Number(d.payAmount),
      donationType: d.donationType,
      donationText: d.donationText,
    },
  };
  try {
    await sendDonation(item);
  } catch (err) {
    log(`후원 전달 실패(나중에 다시 보냄): ${err.message}`);
    pending.push(item);
    savePending();
  }
}

async function flushPending() {
  if (pending.length === 0) return;
  const left = [];
  for (const item of pending) {
    try {
      await sendDonation(item);
    } catch (err) {
      left.push(item);
    }
  }
  if (left.length !== pending.length) log(`밀린 후원 ${pending.length - left.length}건 전달 완료`);
  pending = left;
  savePending();
}
setInterval(() => flushPending().catch(() => {}), RETRY_PENDING_MS);

// --- 치지직 소켓 한 번 연결해서 끊길 때까지 ---
async function runOnce() {
  const { url } = await relay({ action: "session" });
  await new Promise((resolve) => {
    let finished = false;
    const socket = io.connect(url, {
      reconnection: false,
      "force new connection": true,
      "connect timeout": 3000,
      transports: ["websocket"],
    });
    const finish = (why) => {
      if (finished) return;
      finished = true;
      log(why);
      try {
        socket.close();
      } catch {}
      resolve();
    };

    socket.on("connect", () => log("치지직 연결됨"));
    socket.on("SYSTEM", async (raw) => {
      const msg = parse(raw) || {};
      if (msg.type === "connected" && msg.data && msg.data.sessionKey) {
        try {
          await relay({ action: "subscribe", sessionKey: msg.data.sessionKey });
          log("후원 알림 구독 요청 완료 — 후원을 기다리는 중입니다. (이 창은 방송 끝날 때까지 켜두세요)");
        } catch (err) {
          finish(`후원 구독 실패: ${err.message}`);
        }
      } else if (msg.type === "subscribed") {
        log(`구독 확인: ${msg.data && msg.data.eventType ? msg.data.eventType : "DONATION"}`);
      } else if (msg.type === "revoked") {
        finish("치지직에서 구독이 해제됐습니다. 다시 연결합니다.");
      }
    });
    socket.on("DONATION", (raw) => {
      handleDonation(raw).catch((err) => log(`후원 처리 오류: ${err.message}`));
    });
    socket.on("disconnect", (reason) => finish(`연결 끊김 (${reason}) — 잠시 후 다시 연결합니다.`));
    socket.on("connect_error", (err) => finish(`연결 실패 (${err && err.message ? err.message : err})`));
    socket.on("connect_timeout", () => finish("연결 시간 초과"));
    socket.on("error", (err) => finish(`소켓 오류 (${err && err.message ? err.message : err})`));
  });
}

// --- 치지직 채팅창(읽기 전용) — 미션 후원 · 구독권 선물 ---
function chatLog(kind, data) {
  try {
    fs.appendFileSync(CHAT_LOG_PATH, `${new Date().toISOString()} ${kind} ${JSON.stringify(data)}\n`);
  } catch {}
}

async function getJson(url) {
  const res = await fetch(url, { headers: { "User-Agent": BROWSER_UA, Accept: "application/json" }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${url.split("?")[0]})`);
  return res.json();
}

async function getChatChannelId() {
  for (const v of ["v3", "v2"]) {
    try {
      const data = await getJson(`https://api.chzzk.naver.com/polling/${v}/channels/${OWNER_CHANNEL_ID}/live-status`);
      const c = data && data.content;
      if (c) return { chatChannelId: c.chatChannelId || null, live: c.status === "OPEN" };
    } catch (err) {
      if (v === "v2") throw err;
    }
  }
  return { chatChannelId: null, live: false };
}

function openWebSocket(url) {
  // Node 22 이상은 WebSocket이 내장, 아니면 socket.io-client와 같이 깔린 ws 패키지를 씀(따로 설치할 것 없음).
  if (typeof WebSocket === "function") {
    const ws = new WebSocket(url);
    return {
      send: (o) => ws.send(JSON.stringify(o)),
      close: () => { try { ws.close(); } catch {} },
      on: (ev, fn) => {
        if (ev === "message") ws.addEventListener("message", (e) => fn(typeof e.data === "string" ? e.data : String(e.data)));
        else if (ev === "error") ws.addEventListener("error", (e) => fn(e && e.message ? e : new Error("websocket error")));
        else ws.addEventListener(ev, () => fn());
      },
    };
  }
  const WS = require("ws");
  const ws = new WS(url, { headers: { "User-Agent": BROWSER_UA } });
  return {
    send: (o) => ws.send(JSON.stringify(o)),
    close: () => { try { ws.close(); } catch {} },
    on: (ev, fn) => ws.on(ev, (d) => fn(ev === "message" ? String(d) : d)),
  };
}

function obj(v) {
  const p = parse(v);
  return p && typeof p === "object" ? p : {};
}

function donorOf(msgUid, extras) {
  const anonymous = extras.isAnonymous === true || msgUid === "anonymous" || !msgUid;
  const id = extras.userIdHash || msgUid;
  return { donatorChannelId: anonymous || !id || id === "anonymous" ? null : id };
}

function handleChatMessage(m) {
  const type = Number(m.msgTypeCode ?? m.messageTypeCode);
  if (type !== 10 && type !== 12) return;
  const uid = m.uid ?? m.userId;
  const extras = obj(m.extras);
  const profile = obj(m.profile);
  const nickname = profile.nickname || extras.nickname || null;

  if (type === 10) {
    const dt = extras.donationType;
    if (dt !== "MISSION" && dt !== "MISSION_PARTICIPATION") return; // 일반 후원은 공식 API 쪽에서 처리
    chatLog("DONATION", m);
    const missionId = dt === "MISSION" ? extras.missionDonationId : (extras.relatedMissionDonationId || extras.missionDonationId);
    if (!missionId) return log("미션 후원을 받았는데 미션 번호가 없어서 건너뜀(chat-events.log 확인)");
    const amount = Number(extras.payAmount || 0);
    const who = extras.isAnonymous === true || uid === "anonymous" ? "익명" : nickname || "?";
    const eventKey = dt === "MISSION"
      ? `m:${missionId}:c`
      : `m:${missionId}:p:${extras.donationId || `${uid}:${m.msgTime || m.messageTime || amount}`}`;
    sendChatItem({
      action: "mission-part",
      missionId,
      eventKey,
      donation: { ...donorOf(uid, extras), donatorNickname: nickname, payAmount: amount, kind: dt === "MISSION" ? "MISSION" : "MISSION_JOIN", missionText: extras.missionText || null },
    }, `${dt === "MISSION" ? "미션 후원" : "미션 참여"} ${won(amount)}치즈 (${who})`);
    return;
  }

  // type 12 = 구독권 선물. 받는 사람 쪽 알림(SUBSCRIPTION_GIFT_RECEIVER)은 건너뛰고 선물한 사람 기준 한 번만.
  if (extras.giftType === "SUBSCRIPTION_GIFT_RECEIVER") return;
  chatLog("GIFT", m);
  const giftId = extras.giftId;
  if (!giftId) return log("구독권 선물을 받았는데 선물 번호가 없어서 건너뜀(chat-events.log 확인)");
  const quantity = Math.max(1, Number(extras.quantity || 1) - Number(extras.partialRefundedQuantity || 0));
  const who = extras.isAnonymous === true || uid === "anonymous" ? "익명" : nickname || "?";
  sendChatItem({
    action: "gift",
    giftId,
    donation: { ...donorOf(uid, extras), donatorNickname: nickname, quantity, tierNo: Number(extras.giftTierNo || 1) },
  }, `구독권 선물 ${quantity}장 (${who})`);
}

function handleChatEvent(e) {
  if (!e || e.type !== "DONATION_MISSION_IN_PROGRESS") return;
  chatLog("MISSION_EVENT", e);
  const missionId = e.missionDonationId;
  if (!missionId) return;
  const done = e.status === "COMPLETED" || e.status === "REJECTED";
  if (!done) return;
  const success = e.status === "COMPLETED" && e.success === true;
  const anonymous = e.isAnonymous === true || !e.userIdHash;
  sendChatItem({
    action: "mission-result",
    missionId,
    success,
    creator: {
      donatorChannelId: anonymous ? null : e.userIdHash,
      donatorNickname: e.nickname || null,
      payAmount: Number(e.payAmount || 0),
      missionText: e.missionText || null,
    },
  }, `미션 "${String(e.missionText || "").slice(0, 20)}" ${success ? "성공" : "실패/거절"}`);
}

async function chatOnce() {
  const { chatChannelId } = await getChatChannelId();
  if (!chatChannelId) {
    await sleep(CHAT_NOT_LIVE_DELAY_MS);
    return;
  }
  const tok = await getJson(`https://comm-api.game.naver.com/nng_main/v1/chats/access-token?channelId=${encodeURIComponent(chatChannelId)}&chatType=STREAMING`);
  const accTkn = tok && tok.content && tok.content.accessToken;
  if (!accTkn) throw new Error("채팅 접속 토큰을 못 받음");
  const server = (Math.abs([...chatChannelId].reduce((a, c) => a + c.charCodeAt(0), 0)) % 9) + 1;

  await new Promise((resolve) => {
    let finished = false;
    let ping = null;
    let recheck = null;
    const ws = openWebSocket(`wss://kr-ss${server}.chat.naver.com/chat`);
    const finish = (why) => {
      if (finished) return;
      finished = true;
      clearInterval(ping);
      clearInterval(recheck);
      if (why) log(why);
      ws.close();
      resolve();
    };
    ws.on("open", () => {
      ws.send({ ver: "3", cmd: 100, svcid: "game", cid: chatChannelId, tid: 1, bdy: { uid: null, devType: 2001, accTkn, auth: "READ" } });
      ping = setInterval(() => { try { ws.send({ ver: "3", cmd: 0 }); } catch {} }, CHAT_PING_MS);
      // 방송을 새로 켜면 채팅방 번호가 바뀔 수 있어서 가끔 확인.
      recheck = setInterval(async () => {
        try {
          const now = await getChatChannelId();
          if (now.chatChannelId && now.chatChannelId !== chatChannelId) finish("채팅방이 바뀌어서 다시 연결합니다.");
        } catch {}
      }, CHAT_RECHECK_MS);
    });
    ws.on("message", (raw) => {
      const msg = obj(raw);
      const cmd = Number(msg.cmd);
      if (cmd === 0) return ws.send({ ver: "3", cmd: 10000 });
      if (cmd === 10100) {
        if (msg.retCode && msg.retCode !== 0) return finish(`채팅창 연결 거절 (${msg.retMsg || msg.retCode})`);
        return log("채팅창 연결됨 — 미션 후원 · 구독권 선물도 받는 중");
      }
      try {
        if (cmd === 93101 || cmd === 93102) {
          const list = Array.isArray(msg.bdy) ? msg.bdy : [msg.bdy];
          for (const m of list) if (m) handleChatMessage(m);
        } else if (cmd === 93006) {
          handleChatEvent(obj(msg.bdy));
        }
      } catch (err) {
        log(`채팅 메시지 처리 오류: ${err.message}`);
      }
    });
    ws.on("close", () => finish("채팅창 연결 끊김 — 잠시 후 다시 연결합니다."));
    ws.on("error", (err) => finish(`채팅창 오류 (${err && err.message ? err.message : err})`));
  });
}

async function chatLoop() {
  for (;;) {
    try {
      await chatOnce();
      await sleep(RECONNECT_DELAY_MS);
    } catch (err) {
      log(`채팅창 연결 오류: ${err.message} — 잠시 후 다시 시도합니다.`);
      await sleep(RECONNECT_DELAY_MS * 2);
    }
  }
}

async function main() {
  log("유진 팬보드 후원 연동을 시작합니다.");
  await flushPending().catch(() => {});
  chatLoop();
  for (;;) {
    try {
      await runOnce();
      await sleep(RECONNECT_DELAY_MS);
    } catch (err) {
      if (err.code === "no_streamer_token") {
        log("서버에 유진님 치지직 로그인 정보가 없습니다(또는 30일 넘게 방송이 없어 만료됨).");
        log("사이트에서 로그아웃했다가 유진 알파 계정으로 다시 로그인해 주세요. 1분 뒤 다시 시도합니다.");
        await sleep(NEED_LOGIN_DELAY_MS);
      } else if (err.code === "unauthorized") {
        log("중계 비밀번호가 맞지 않습니다. config.json을 확인해 주세요. 1분 뒤 다시 시도합니다.");
        await sleep(NEED_LOGIN_DELAY_MS);
      } else {
        log(`오류: ${err.message} — 잠시 후 다시 시도합니다.`);
        await sleep(RECONNECT_DELAY_MS * 2);
      }
    }
  }
}

main();
