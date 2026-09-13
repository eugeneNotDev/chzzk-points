// 포인트 사용 엔드포인트.
// 프론트엔드(shop.html)의 "사용" 버튼이 이 함수를 호출한다 (Authorization: Bearer <세션토큰>).
//
// TODO: _shared/session.ts의 extractBearerToken + verifySessionToken으로 channelId 확인 (비로그인 시 401)
// TODO: 요청 바디에서 소모처 id, 비용 확인
// TODO: points_ledger에서 현재 잔액 조회
// TODO: 잔액 부족 시 거절
// TODO: 잔액 충분하면 차감 기록 + spend_events 테이블에 이벤트 기록 (오버레이가 이걸 구독함)

Deno.serve(async (req: Request) => {
  return new Response("TODO: spend-points", { status: 501 });
});
