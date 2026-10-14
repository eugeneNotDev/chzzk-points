// 사이트 전체 상수. 기존 사이트(chzzk-auth.js, supabase-client.js)와 값이 똑같아야 함.
// (시크릿 아님 — 공개 client id, 공개 anon key, 공개 channelId)

export const CHZZK_CLIENT_ID = "30d0a593-bc56-4239-ac79-3db1e0bf1202";
// 치지직 개발자센터의 "로그인 리디렉션 URL"과 글자 하나까지 같아야 함.
// 베타 기간엔 로그인하면 기존 사이트(루트)로 돌아가서 거기서 로그인이 마무리되고, 토큰은 같은 도메인의
// localStorage에 저장되니 /beta/ 에서도 그대로 로그인 상태가 됨.
export const CHZZK_REDIRECT_URI = "https://eugene4lpha.com/";

export const SUPABASE_URL = "https://azowisiuyeohhfxxmewb.supabase.co";
export const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF6b3dpc2l1eWVvaGhmeHhtZXdiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkzMTQ3MTUsImV4cCI6MjEwNDg5MDcxNX0.Ov-rYD_roBJuRTqTnZUD397aHynGIzkvb1linnuBa6s";

export const FUNCTIONS_BASE_URL = `${SUPABASE_URL}/functions/v1`;
export const API = {
  oauthCallback: `${FUNCTIONS_BASE_URL}/oauth-callback`,
  me: `${FUNCTIONS_BASE_URL}/me`,
  broadcastStatus: `${FUNCTIONS_BASE_URL}/broadcast-status`,
  board: `${FUNCTIONS_BASE_URL}/board`,
  freeBox: `${FUNCTIONS_BASE_URL}/free-box`,
  notices: `${FUNCTIONS_BASE_URL}/notices`,
  attendance: `${FUNCTIONS_BASE_URL}/attendance-check`,
  streamCode: `${FUNCTIONS_BASE_URL}/stream-code`,
  admin: `${FUNCTIONS_BASE_URL}/admin`,
  shopItems: `${FUNCTIONS_BASE_URL}/shop-items`,
  spendPoints: `${FUNCTIONS_BASE_URL}/spend-points`,
  predictions: `${FUNCTIONS_BASE_URL}/predictions`,
  roulette: `${FUNCTIONS_BASE_URL}/roulette`,
  rps: `${FUNCTIONS_BASE_URL}/rps`,
  oddEven: `${FUNCTIONS_BASE_URL}/odd-even`,
  songs: `${FUNCTIONS_BASE_URL}/songs`,
  push: `${FUNCTIONS_BASE_URL}/push`,
  adminRanking: `${FUNCTIONS_BASE_URL}/admin-ranking`,
} as const;

export const OWNER_CHANNEL_ID = "37a1acfaa35d56311bf428dc96142e9f";

// 브랜드 이미지는 기존 사이트 파일을 그대로 씀(절대 경로라 /beta/ 에서도, 교체 후에도 같은 파일).
export const BRAND_MARK_URL = "/assets/img/brand-mark.png";

// 치지직 채널 주소 — "치지직에서 보기" 버튼.
export const CHZZK_CHANNEL_URL = `https://chzzk.naver.com/live/${OWNER_CHANNEL_ID}`;

// localStorage 키 — 기존 사이트와 공유(같은 도메인이라 로그인·테마·공지 읽음 기록이 그대로 이어짐).
export const STORAGE = {
  token: "chzzk_points_token",
  channelId: "chzzk_points_channel_id",
  channelName: "chzzk_points_channel_name",
  oauthState: "chzzk_points_oauth_state",
  profileImage: "chzzk_points_profile_image",
  rankKey: "chzzk_points_rank_key",
  balance: "chzzk_points_balance_cache",
  theme: "chzzk_points_theme",
  noticeReadIds: "chzzk_points_notice_read_ids",
  boardSeen: "chzzk_board_seen",
} as const;
