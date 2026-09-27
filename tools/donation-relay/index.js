// 유진 팬보드 후원 연동 — 방송 PC에서 방송하는 동안 켜두는 프로그램.
//
// 하는 일: 치지직 공식 API로 유진님 채널의 후원 알림을 받아서, 사이트 서버(Edge Function donation-relay)로
// 그대로 넘겨줌. 적립할지 말지(1만 치즈 이상 / 익명 / 가입자 여부)는 전부 서버가 판단함.
// 이 프로그램에는 치지직 토큰이나 DB 열쇠가 없고, config.json의 "중계 비밀번호"만 있음.
//
// 흐름: 서버에 소켓 주소 요청 → 치지직 소켓 연결 → 연결되면 받은 sessionKey로 후원 구독 요청
//       → 후원(DONATION)이 오면 서버로 전달 → 연결이 끊기면 몇 초 뒤 처음부터 다시.
// 서버로 못 보낸 후원은 pending.json에 모아뒀다가 다시 보냄(같은 후원이 두 번 적립되지는 않음 — eventKey).

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const io = require("socket.io-client");

const CONFIG_PATH = path.join(__dirname, "config.json");
const PENDING_PATH = path.join(__dirname, "pending.json");
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
  const result = await relay({ action: "donation", eventKey: item.eventKey, donation: item.donation });
  log(describe(result, item.donation));
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

async function main() {
  log("유진 팬보드 후원 연동을 시작합니다.");
  await flushPending().catch(() => {});
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
