// 웹 푸시(방송 알림) 보내기 — 외부 라이브러리 없이 WebCrypto만 사용.
//   - 내용 암호화: RFC 8291 (aes128gcm) — 받는 브라우저만 풀 수 있게 구독마다 따로 암호화
//   - 보낸 사람 인증: RFC 8292 (VAPID) — ES256 서명한 JWT
// VAPID 비밀키는 저장소에 없고 DB(app_secrets: vapid_private_jwk)에만 있음. 공개키는 사이트 JS에 그대로 들어감.

// 바이트 배열 — 새 TypeScript에선 WebCrypto가 ArrayBuffer 기반 배열만 받는다고 타입을 엄격히 봐서 이름을 붙여 둠(동작은 같음)
type Bytes = Uint8Array<ArrayBuffer>;

const enc = new TextEncoder();

export function b64urlEncode(bytes: Bytes): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64urlDecode(str: string): Bytes {
  const s = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function concat(...parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hmac(key: Bytes, data: Bytes): Promise<Bytes> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

// 비공개키(d) + 공개키(65바이트 0x04|x|y) → ECDH/ECDSA용 키
async function importPrivate(d: Bytes, pub: Bytes, usage: "ECDH" | "ECDSA"): Promise<CryptoKey> {
  const jwk = { kty: "EC", crv: "P-256", d: b64urlEncode(d), x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)), ext: true };
  return usage === "ECDH"
    ? await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])
    : await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export interface EncryptOptions {
  // 테스트용(RFC 8291 예시값 재현) — 평소엔 비워두면 매번 새로 만듦
  senderPrivate?: Bytes;
  senderPublic?: Bytes;
  salt?: Bytes;
}

// RFC 8291 — 구독(p256dh, auth)용으로 payload 암호화한 요청 본문(Content-Encoding: aes128gcm)
export async function encryptPayload(p256dh: Bytes, authSecret: Bytes, payload: Bytes, opts: EncryptOptions = {}): Promise<Bytes> {
  let asPrivate: CryptoKey;
  let asPublic: Bytes;
  if (opts.senderPrivate && opts.senderPublic) {
    asPrivate = await importPrivate(opts.senderPrivate, opts.senderPublic, "ECDH");
    asPublic = opts.senderPublic;
  } else {
    const kp = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
    asPrivate = kp.privateKey;
    asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey));
  }
  const uaKey = await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, asPrivate, 256));

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(enc.encode("WebPush: info\0"), p256dh, asPublic, new Uint8Array([1]));
  const ikm = (await hmac(prkKey, keyInfo)).slice(0, 32);

  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const plain = concat(payload, new Uint8Array([2])); // 마지막 레코드 표시(0x02), 패딩 없음
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, plain));

  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

export interface VapidKeys {
  publicKey: string;  // b64url, 65바이트
  privateKey: string; // b64url, 32바이트(d)
  subject: string;    // mailto:...
}

// RFC 8292 — Authorization: vapid t=<JWT>, k=<공개키>
export async function vapidAuthHeader(endpoint: string, keys: VapidKeys): Promise<string> {
  const aud = new URL(endpoint).origin;
  const header = b64urlEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64urlEncode(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: keys.subject })));
  const signingKey = await importPrivate(b64urlDecode(keys.privateKey), b64urlDecode(keys.publicKey), "ECDSA");
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signingKey, enc.encode(`${header}.${body}`)));
  return `vapid t=${header}.${body}.${b64urlEncode(sig)}, k=${keys.publicKey}`;
}

export interface PushSubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

// 한 구독에 보내기 → HTTP 상태코드(201 성공 / 404·410 = 구독이 없어짐 → 지워야 함)
export async function sendPush(sub: PushSubscriptionRow, payload: unknown, keys: VapidKeys, opts: { ttl?: number; urgency?: string; topic?: string } = {}): Promise<number> {
  const body = await encryptPayload(b64urlDecode(sub.p256dh), b64urlDecode(sub.auth), enc.encode(JSON.stringify(payload)));
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Encoding": "aes128gcm",
    TTL: String(opts.ttl ?? 1800),
    Urgency: opts.urgency ?? "high",
    Authorization: await vapidAuthHeader(sub.endpoint, keys),
  };
  if (opts.topic) headers.Topic = opts.topic;
  // 응답 없는 주소 하나 때문에 전체 발송이 멈추지 않게 8초 제한
  const res = await fetch(sub.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
  await res.body?.cancel();
  return res.status;
}
