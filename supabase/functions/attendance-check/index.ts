// 방송 중 최초 접속 출석 체크 보너스.
// 로그인 상태에서 mypage.html 등을 열었을 때 호출한다.
//
// TODO: 세션에서 channelId 확인
// TODO: "현재 방송 중"인지 확인 (로컬 리스너가 써둔 방송 상태 테이블 참고)
// TODO: 오늘/이번 방송에 이미 출석 체크했는지 확인 (중복 방지)
// TODO: 안 했으면 포인트 지급 + 출석 기록 남기기

Deno.serve(async (req: Request) => {
  return new Response("TODO: attendance-check", { status: 501 });
});
