# 유진 키우기 내용(직업·수식어·마무리·이벤트·특수 엔딩)의 원본. 고친 뒤 `python gen_seed.py 0090_life_content.sql`처럼
# 새 마이그레이션 파일 이름을 주고 실행 → 그 파일을 DB에 적용(같은 id는 덮어씀). DB와 이 파일이 항상 같게 유지할 것.
import json, sys

def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, (dict, list)):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"

def upsert(table, cols, rows):
    out = [f"insert into public.{table} ({', '.join(cols)}) values"]
    vals = []
    for r in rows:
        vals.append('  (' + ', '.join(q(r.get(c)) for c in cols) + ')')
    out.append(',\n'.join(vals))
    upd = ', '.join(f"{c} = excluded.{c}" for c in cols if c != 'id')
    out.append(f"on conflict (id) do update set {upd};")
    return '\n'.join(out)

# ── 직업 ──
J = lambda id, name, cat, cond, yearly, hint, age_min=20, weight=10: dict(
    id=id, name=name, category=cat, cond=cond, yearly=yearly, hint=hint, age_min=age_min, weight=weight)
jobs = [
    J('vtuber', '버튜버', '방송 · 예술', {"anyflags": ["vtuber_debut", "broadcast_start"], "min": {"talent": 50}}, {"happy": 2, "talent": 1}, '방송을 꿈꾸게 되면…', weight=25),
    J('singer_indie', '무명 가수', '방송 · 예술', {"anyflags": ["music", "music_school"], "min": {"talent": 55}}, {"talent": 1, "wealth": -1, "happy": 1}, '음악을 놓지 않으면…'),
    J('webnovel', '웹소설 작가', '방송 · 예술', {"anyflags": ["bookworm", "artsy"], "min": {"intel": 50}}, {"intel": 1, "wealth": 1}, '책과 그림을 좋아하면…'),
    J('voice_actor', '성우', '방송 · 예술', {"min": {"talent": 60, "charm": 45}}, {"wealth": 2, "charm": 1}, '끼와 매력이 둘 다 있으면…'),
    J('illustrator', '일러스트레이터', '방송 · 예술', {"flags": ["artsy"]}, {"talent": 1, "wealth": 1}, '공책에 낙서를 많이 하면…'),
    J('game_streamer', '게임 스트리머', '방송 · 예술', {"flags": ["game"], "min": {"charm": 45}}, {"happy": 2, "health": -1}, '게임을 너무 좋아하면…'),
    J('idol', '아이돌', '방송 · 예술', {"min": {"charm": 70, "talent": 60}}, {"charm": 2, "wealth": 3, "health": -1}, '아주 반짝이는 사람이 되면…', age_min=18),
    J('office', '회사원', '자영업 · 직장', {"min": {"intel": 40}}, {"wealth": 2, "happy": -1}, '평범하게 공부하면…', weight=30),
    J('conv_store', '편의점 알바', '자영업 · 직장', {}, {"wealth": 1}, '누구나 한 번쯤은…', age_min=18, weight=15),
    J('delivery', '배달 기사', '자영업 · 직장', {"max": {"wealth": 50}}, {"wealth": 1, "health": -1}, '돈이 급하면…'),
    J('civil', '공무원', '자영업 · 직장', {"min": {"intel": 60}}, {"wealth": 1, "happy": 1}, '안정을 원하면…'),
    J('programmer', '개발자', '자영업 · 직장', {"min": {"intel": 60}, "flags": ["game"]}, {"wealth": 3, "health": -1}, '게임도 좋아하고 머리도 좋으면…'),
    J('chef', '요리사', '자영업 · 직장', {"flags": ["cook"]}, {"wealth": 1, "happy": 1}, '요리에 눈을 뜨면…'),
    J('gukbap', '국밥집 사장', '자영업 · 직장', {"flags": ["cook", "shop_owner"]}, {"wealth": 2, "happy": 1}, '요리를 좋아하고 가게를 차리면…', age_min=28, weight=30),
    J('cafe', '카페 사장', '자영업 · 직장', {"flags": ["shop_owner"], "min": {"wealth": 50}}, {"wealth": 1, "happy": 2}, '여유 있게 가게를 차리면…', age_min=28),
    J('farmer', '귀농 농부', '자영업 · 직장', {"min": {"health": 50}}, {"health": 1, "happy": 2}, '도시가 지칠 때쯤…', age_min=35, weight=5),
    J('doctor', '의사', '전문직', {"min": {"intel": 82}, "flags": ["college"]}, {"wealth": 4, "health": -1}, '대학에 가서 아주 열심히 공부하면…'),
    J('lawyer', '변호사', '전문직', {"min": {"intel": 78}, "flags": ["college"]}, {"wealth": 4, "happy": -1}, '말도 잘하고 공부도 잘하면…'),
    J('professor', '교수', '전문직', {"min": {"intel": 80}, "flags": ["college", "bookworm"]}, {"wealth": 2, "intel": 1}, '책벌레가 대학에 남으면…', age_min=30),
    J('athlete', '운동선수', '전문직', {"flags": ["sporty"], "min": {"health": 70}}, {"health": 1, "wealth": 2}, '운동을 잘하고 튼튼하면…', age_min=19),
    J('ceo', '재벌 회장', '전문직', {"house": ["rich"], "min": {"intel": 45}}, {"wealth": 5, "happy": -1}, '좋은 집에서 태어나면…', age_min=30, weight=20),
]

# ── 엔딩 수식어 ──
M = lambda id, text, cond, pr, hint: dict(id=id, text=text, cond=cond, priority=pr, hint=hint)
mods = [
    M('rich_lonely', '돈은 많지만 외로운', {"min": {"wealth": 75}, "max": {"happy": 40}}, 30, '돈은 넘치는데 마음은 텅 비면…'),
    M('poor_happy', '가난해도 웃음 많은', {"max": {"wealth": 30}, "min": {"happy": 70}}, 30, '가진 건 없어도 행복하면…'),
    M('rags_up', '고생 끝에 낙이 온', {"house": ["poor"], "min": {"wealth": 60}}, 28, '단칸방에서 시작해 자리를 잡으면…'),
    M('smart_awkward', '머리는 좋았지만 사회생활은 서툰', {"min": {"intel": 80}, "max": {"charm": 35}}, 25, '공부만 하고 사람은 어려워하면…'),
    M('loved', '모두에게 사랑받은', {"min": {"charm": 80}}, 25, '매력이 넘치면…'),
    M('hidden_genius', '세상이 몰라본 천재', {"min": {"intel": 85, "talent": 70}, "max": {"wealth": 40}}, 24, '재능은 넘치는데 돈이 없으면…'),
    M('dreamer', '끝까지 꿈을 쫓은', {"anyflags": ["mic", "music", "artsy", "dream_chase"], "max": {"wealth": 45}}, 20, '꿈을 포기하지 않으면…'),
    M('family', '가족밖에 모르던', {"flags": ["kid"], "min": {"happy": 55}}, 18, '가정을 꾸리고 행복하면…'),
    M('wanderer', '세상을 떠돌던', {"flags": ["travel"]}, 16, '여행을 떠나면…'),
    M('rich', '부자가 된', {"min": {"wealth": 85}}, 20, '재산을 크게 모으면…'),
    M('happy', '행복하게 산', {"min": {"happy": 85}}, 20, '아주 행복하면…'),
    M('healthy', '건강 하나는 자신 있던', {"min": {"health": 80}}, 15, '몸이 튼튼하면…'),
    M('carefree', '철없는', {"max": {"intel": 30}}, 15, '공부와 담을 쌓으면…'),
    M('ordinary', '평범하지만 단단한', {}, 0, '누구나 한 번쯤은…'),
]

# ── 엔딩 마무리 ──
F = lambda id, text, cond, pr: dict(id=id, text=text, cond=cond, priority=pr)
fins = [
    F('accident', '갑작스러운 사고로 너무 일찍 떠났어요', {"flags": ["death_accident"]}, 50),
    F('sick', '오랜 투병 끝에 눈을 감았어요', {"flags": ["death_sick"]}, 40),
    F('stage', '무대 위에서 마지막 인사를 했어요', {"flags": ["death_old"], "job": ["vtuber", "singer_indie", "idol", "game_streamer", "voice_actor"]}, 30),
    F('grandkids', '손주들 품에서 편안히 잠들었어요', {"flags": ["death_old", "kid"]}, 25),
    F('alone', '혼자였지만 담담하게 떠났어요', {"flags": ["death_old", "lonely"]}, 20),
    F('travel', '마지막 여행지에서 노을을 보며 잠들었어요', {"flags": ["death_old", "travel"]}, 18),
    F('old', '천수를 누리고 편안히 잠들었어요', {"flags": ["death_old"]}, 10),
    F('default', '조용히 눈을 감았어요', {}, 0),
]

# ── 이벤트 ──
def E(id, kind, a0, a1, text, effects=None, cond=None, weight=10, once=True, diary=None, choices=None, hint=None):
    return dict(id=id, kind=kind, age_min=a0, age_max=a1, text=text, effects=effects or {}, cond=cond or {},
                weight=weight, once=once, diary=diary, choices=choices, hint=hint)
S = lambda **k: {"stats": k}
def SA(add=None, remove=None, **k):
    d = {"stats": k}
    if add: d["add"] = add
    if remove: d["remove"] = remove
    return d
WORK = {"nojob": ["student"]}

events = [
    # 유년
    E('d_first_word', 'daily', 1, 2, "첫 마디가 '엄마'도 '아빠'도 아닌 '밥'이었다.", S(happy=2)),
    E('d_crayon', 'daily', 3, 6, '벽에 크레파스로 늑대를 그려서 혼났다.', S(talent=3, happy=-1)),
    E('d_kinder_song', 'daily', 4, 7, '유치원 발표회에서 노래를 불렀다. 박자는 맞지 않았다.', S(talent=2, charm=1)),
    E('d_fever', 'daily', 0, 7, '열이 펄펄 끓어 밤새 앓았다.', S(health=-4), once=False, weight=4),
    E('d_pet', 'daily', 4, 12, '길에서 떠돌던 강아지를 데려와 키우게 됐다.', SA(add=["pet"], happy=5)),
    # 학생
    E('d_test_good', 'daily', 8, 19, '시험을 잘 봐서 칭찬받았다.', S(intel=3, happy=1), once=False, weight=8),
    E('d_test_bad', 'daily', 8, 19, '밤새 게임하다 시험을 망쳤다.', SA(add=["game"], intel=-3, happy=1), once=False, weight=6),
    E('d_friend', 'daily', 8, 19, '평생 갈 친구를 만났다.', SA(add=["friend"], happy=4, charm=2)),
    E('d_fight', 'daily', 10, 17, '친구랑 크게 싸웠지만 다음 날 먼저 사과했다.', S(charm=3)),
    E('d_sports', 'daily', 8, 18, '체육대회 계주에서 역전승을 했다.', SA(add=["sporty"], health=4, happy=2)),
    E('d_mic', 'daily', 13, 19, '모은 용돈으로 중고 마이크를 샀다.', SA(add=["mic"], happy=4, wealth=-3), cond={"min": {"talent": 45}}, weight=14,
      diary='마이크가 생겼다. 아무도 안 들어도 상관없다.'),
    E('d_guitar', 'daily', 12, 19, '기타를 독학하기 시작했다. 손가락이 아프다.', SA(add=["music"], talent=4)),
    E('d_drawing', 'daily', 10, 19, '공책 귀퉁이마다 그림을 그렸다.', SA(add=["artsy"], talent=3)),
    E('d_cook', 'daily', 10, 25, '처음 끓인 라면이 기가 막혔다. 요리에 눈을 떴다.', SA(add=["cook"], happy=2)),
    E('d_library', 'daily', 10, 19, '도서관에서 하루 종일 책만 읽었다.', SA(add=["bookworm"], intel=4)),
    E('d_cram', 'daily', 15, 19, '학원 세 군데를 돌며 버텼다.', S(intel=4, health=-2, happy=-3)),
    E('d_crush', 'daily', 14, 19, '고백했다가 차였다.', S(happy=-4, charm=1), diary='오늘은 일기 안 쓸 거다.'),
    # 어른
    E('d_overtime', 'daily', 22, 64, '야근이 이어졌다.', S(health=-3, wealth=2, happy=-2), cond=WORK, once=False, weight=4),
    E('d_raise', 'daily', 24, 64, '월급이 올랐다.', S(wealth=5, happy=2), cond=WORK, once=False, weight=5),
    E('d_love', 'daily', 20, 40, '운명 같은 사람을 만났다.', SA(add=["love"], happy=6), weight=8),
    E('d_married', 'daily', 25, 45, '결혼식을 올렸다.', SA(add=["married"], happy=5, wealth=-5), cond={"flags": ["love"], "noflags": ["married"]}, weight=12),
    E('d_kid', 'daily', 27, 45, '아이가 태어났다.', SA(add=["kid"], happy=6, wealth=-4, health=-1), cond={"flags": ["married"]}, weight=12,
      diary='작은 손이 내 손가락을 꽉 잡았다.'),
    E('d_travel', 'daily', 20, 60, '훌쩍 혼자 여행을 떠났다.', SA(add=["travel"], happy=5, wealth=-3)),
    E('d_gym', 'daily', 20, 60, '헬스장을 끊었다. 세 번 갔다.', S(health=1, wealth=-2)),
    E('d_stock_loss', 'daily', 25, 60, '주식에 손댔다가 크게 잃었다.', S(wealth=-8, happy=-3), once=False, weight=4),
    E('d_stock_win', 'daily', 25, 60, '산 주식이 갑자기 올랐다.', S(wealth=8, happy=3), weight=4),
    E('d_sick', 'daily', 35, 85, '건강검진에서 경고를 받았다.', SA(add=["sick"], health=-6), once=False, weight=3),
    E('d_lonely', 'daily', 30, 70, '주말 내내 아무와도 말하지 않았다.', SA(add=["lonely"], happy=-4), cond={"max": {"charm": 40}}),
    E('d_yang', 'daily', 20, 60, "고정 시청자들이 생겼다. 팬들을 '양'이라고 부르기로 했다.", SA(add=["yangs"], happy=6), cond={"job": ["vtuber"]}, weight=20,
      diary='오늘 시청자가 열 명을 넘었다. 양들이 생겼다.'),
    E('d_stream_song', 'daily', 20, 80, "노래 방송을 했다. 채팅창이 'ㅋㅋㅋ'로 가득 찼다.", S(happy=3, charm=2), cond={"job": ["vtuber"]}, once=False, weight=8),
    E('d_shop_hit', 'daily', 28, 75, '가게 앞에 줄이 생겼다.', S(wealth=6, happy=3), cond={"job": ["gukbap", "chef", "cafe"]}, weight=10),
    # 노년
    E('d_grandkid', 'daily', 55, 90, '손주가 태어났다.', S(happy=6), cond={"flags": ["kid"]}, weight=12),
    E('d_walk', 'daily', 60, 100, '매일 아침 동네 한 바퀴를 걸었다.', S(health=2, happy=1), once=False, weight=3),
    E('d_reunion', 'daily', 60, 90, '어릴 적 친구와 다시 만나 밤새 웃었다.', S(happy=6), cond={"flags": ["friend"]}),
    E('d_memory', 'daily', 70, 100, '오래된 일기장을 꺼내 읽었다.', S(happy=3), diary='생각보다 괜찮은 인생이었다.'),
    # 늑대
    E('d_wolf1', 'daily', 12, 25, '늑대 탈을 쓴 꿈을 꿨다. 이상하게 익숙했다.', SA(add=["wolf_dream1"]), weight=1),
    E('d_wolf2', 'daily', 16, 35, "또 늑대 꿈을 꿨다. 이번엔 누군가 '양'이라고 불렀다.", SA(add=["wolf_dream2"]), cond={"flags": ["wolf_dream1"]}, weight=1),

    # 갈림길
    E('c_broadcast', 'crossroad', 15, 19, '유진이 방송을 해보고 싶다며 조심스럽게 말을 꺼낸다.', cond={"min": {"talent": 40}}, weight=20, choices=[
        {"key": "A", "text": "장비를 사준다", "hint": "재산 ↓ 행복 ↑", "result": "보호자가 새 장비를 사줬다.", "effects": SA(add=["mic", "broadcast_start"], wealth=-6, happy=5, talent=3)},
        {"key": "B", "text": "공부부터 하라고 한다", "hint": "지능 ↑ 행복 ↓", "result": "방송은 대학 가서 하기로 했다.", "effects": S(intel=4, happy=-4)},
        {"key": "C", "text": "몰래 응원만 한다", "hint": "???", "result": "보호자가 몰래 응원해 줬다. 첫 방송을 켰다.", "effects": SA(add=["broadcast_start", "secret_support"], happy=3)},
    ]),
    E('c_music_school', 'crossroad', 14, 18, '예고 입시를 보고 싶다고 한다.', cond={"flags": ["music"]}, weight=20, choices=[
        {"key": "A", "text": "보낸다", "hint": "끼 ↑ 재산 ↓", "result": "예고에 합격했다.", "effects": SA(add=["music_school"], talent=8, wealth=-6)},
        {"key": "B", "text": "취미로만 하라고 한다", "hint": "지능 ↑ 행복 ↓", "result": "기타는 방 구석에 세워뒀다.", "effects": S(intel=3, happy=-3)},
    ]),
    E('c_university', 'crossroad', 18, 19, '수능이 끝났다. 진로를 정해야 한다.', weight=30, choices=[
        {"key": "A", "text": "대학에 간다", "hint": "지능 ↑ 재산 ↓", "result": "대학에 입학했다.", "effects": SA(add=["college"], intel=6, wealth=-4)},
        {"key": "B", "text": "바로 일을 시작한다", "hint": "재산 ↑", "result": "일찍 사회에 나가기로 했다.", "effects": S(wealth=5, intel=-1)},
        {"key": "C", "text": "1년 쉬면서 하고 싶은 걸 찾는다", "hint": "행복 ↑ 끼 ↑", "result": "1년 동안 하고 싶은 걸 찾아다녔다.", "effects": SA(add=["dream_chase"], happy=4, talent=3)},
    ]),
    E('c_vtuber_debut', 'crossroad', 20, 35, '버추얼 데뷔 제안이 들어왔다.', cond={"flags": ["broadcast_start"], "nojob": ["vtuber"]}, weight=25, choices=[
        {"key": "A", "text": "데뷔한다", "hint": "끼 ↑", "result": "늑대 귀가 달린 아바타로 데뷔했다.", "effects": {"stats": {"talent": 4, "happy": 3}, "add": ["vtuber_debut"], "job": "vtuber"},
         "diary": "오늘부터 나는 버튜버다."},
        {"key": "B", "text": "거절한다", "hint": "재산 ↑ 행복 ↓", "result": "방송은 추억으로 남기기로 했다.", "effects": S(wealth=2, happy=-2)},
    ]),
    E('c_quit_job', 'crossroad', 25, 45, '회사를 그만두고 하고 싶은 걸 하고 싶다고 한다.', cond={"job": ["office", "civil", "programmer", "delivery", "conv_store"]}, weight=15, choices=[
        {"key": "A", "text": "응원한다", "hint": "행복 ↑ 재산 ↓", "result": "사표를 냈다. 속이 시원했다.", "effects": SA(add=["dream_chase"], happy=6, wealth=-8)},
        {"key": "B", "text": "현실을 생각하라고 한다", "hint": "재산 ↑ 행복 ↓", "result": "한숨을 쉬고 다시 출근했다.", "effects": S(wealth=4, happy=-4)},
    ]),
    E('c_marry', 'crossroad', 26, 40, '연인이 결혼하자고 한다.', cond={"flags": ["love"], "noflags": ["married"]}, weight=20, choices=[
        {"key": "A", "text": "한다", "hint": "행복 ↑ 재산 ↓", "result": "작은 결혼식을 올렸다.", "effects": SA(add=["married"], happy=6, wealth=-5)},
        {"key": "B", "text": "아직은 이르다", "hint": "행복 ↓", "result": "결혼은 미루기로 했다. 연인은 떠났다.", "effects": SA(remove=["love"], add=["lonely"], happy=-4)},
    ]),
    E('c_house', 'crossroad', 30, 50, '집을 살까 고민 중이다.', cond={"min": {"wealth": 35}}, weight=12, choices=[
        {"key": "A", "text": "영끌한다", "hint": "재산 ↓ 행복 ↑", "result": "내 집이 생겼다. 대출도 생겼다.", "effects": SA(add=["home_owner"], wealth=-15, happy=4)},
        {"key": "B", "text": "전세로 버틴다", "hint": "변화 없음", "result": "조금 더 지켜보기로 했다.", "effects": {}},
    ]),
    E('c_shop', 'crossroad', 28, 55, '가게를 차려보고 싶다고 한다.', cond={"flags": ["cook"], "noflags": ["shop_owner"]}, weight=18, choices=[
        {"key": "A", "text": "차린다", "hint": "재산 ↓", "result": "작은 가게를 열었다.", "effects": SA(add=["shop_owner"], wealth=-10, happy=3)},
        {"key": "B", "text": "말린다", "hint": "행복 ↓", "result": "가게는 꿈으로 남겨두기로 했다.", "effects": S(happy=-3)},
    ]),
    E('c_health', 'crossroad', 40, 75, '의사가 생활 습관을 바꾸라고 한다.', cond={"flags": ["sick"]}, weight=20, choices=[
        {"key": "A", "text": "술·담배를 끊는다", "hint": "건강 ↑ 행복 ↓", "result": "독하게 마음먹고 끊었다.", "effects": SA(remove=["sick"], health=10, happy=-2)},
        {"key": "B", "text": "하던 대로 산다", "hint": "건강 ↓ 행복 ↑", "result": "인생 뭐 있나 싶었다.", "effects": S(happy=2, health=-6)},
    ]),
    E('c_fan_letter', 'crossroad', 22, 70, '시청자에게 긴 편지를 받았다.', cond={"job": ["vtuber"]}, weight=15, choices=[
        {"key": "A", "text": "방송에서 읽어준다", "hint": "매력 ↑", "result": "방송에서 편지를 읽다가 목이 메었다.", "effects": SA(add=["yangs"], charm=4, happy=4)},
        {"key": "B", "text": "혼자 몰래 읽는다", "hint": "행복 ↑", "result": "편지를 지갑에 넣고 다녔다.", "effects": S(happy=5)},
    ]),
    E('c_retire', 'crossroad', 62, 75, '은퇴 후 뭘 할지 고민 중이다.', weight=15, choices=[
        {"key": "A", "text": "노래 교실에 다닌다", "hint": "행복 ↑ 끼 ↑", "result": "노래 교실에 등록했다. 선생님이 한숨을 쉬었다.", "effects": S(happy=5, talent=2)},
        {"key": "B", "text": "세계 일주를 떠난다", "hint": "재산 ↓ 행복 ↑", "result": "배낭 하나 메고 떠났다.", "effects": SA(add=["travel"], wealth=-10, happy=8)},
        {"key": "C", "text": "집에서 푹 쉰다", "hint": "건강 ↑", "result": "드디어 늦잠을 잤다.", "effects": S(health=4, happy=2)},
    ]),
    E('c_wolf', 'crossroad', 18, 40, "꿈속 늑대가 '이제 기억났냐'고 묻는다.", cond={"flags": ["wolf_dream2"]}, weight=3, choices=[
        {"key": "A", "text": "기억났다고 대답한다", "hint": "???", "result": "늑대가 웃었다. 무언가 깨어난 기분이다.", "effects": SA(add=["wolf_dream3"], talent=5),
         "diary": "나는 원래 늑대였던 것 같다."},
        {"key": "B", "text": "그냥 꿈이라고 넘긴다", "hint": "평범하게", "result": "그 뒤로 늑대 꿈은 꾸지 않았다.", "effects": SA(remove=["wolf_dream1", "wolf_dream2"], happy=1)},
    ]),

    # 희귀
    E('r_lottery', 'rare', 20, 85, '복권 2등에 당첨됐다!', S(wealth=30, happy=8), hint='아주 가끔 하늘에서 돈이 떨어지면…'),
    E('r_ufo', 'rare', 10, 85, '밤하늘에서 이상한 빛을 봤다. 아무도 믿어주지 않았다.', S(happy=2), hint='밤하늘을 올려다보면…'),
    E('r_viral', 'rare', 18, 60, '올린 영상이 하룻밤 사이에 백만 조회수를 찍었다.', SA(add=["fame"], charm=10, wealth=8), cond={"anyflags": ["mic", "music", "artsy"]},
      hint='끼를 세상에 보여주면…'),
    E('r_celeb', 'rare', 15, 70, '길에서 유명 연예인과 부딪혔다. 사인은 못 받았다.', S(happy=3), hint='번화가를 걷다 보면…'),
    E('r_twin', 'rare', 15, 80, '자신과 똑같이 생긴 사람을 봤다. 다른 평행세계의 유진일까?', S(happy=1), hint='평행세계가 겹치는 순간이 있다면…'),
    E('r_hero', 'rare', 20, 70, '물에 빠진 아이를 구했다. 뉴스에 나왔다.', S(charm=8, happy=5), hint='용기를 내야 하는 순간이 오면…'),
    E('r_ghost', 'rare', 10, 70, '새벽 3시, 방 안에서 누군가 이름을 불렀다.', S(happy=-3, health=-1), hint='미스테리한 밤이 찾아오면…'),
    E('r_wolf_moon', 'rare', 16, 90, '보름달 아래서 늑대 울음소리를 따라 불렀다. 처음으로 음정이 맞았다.', S(talent=10), cond={"flags": ["wolf_dream3"]},
      hint='늑대의 기억을 되찾으면…'),
]


# ── 2차 추가 이벤트 ──
FX = lambda *ids: {"anyflags": ["focus_" + i for i in ids]}
events += [
    # 어린 시절 갈림길
    E('c_kinder_dream', 'crossroad', 5, 7, '유치원에서 장래희망을 물어봤다.', weight=20, choices=[
        {"key": "A", "text": "가수라고 한다", "hint": "끼 ↑", "result": "유진은 가수가 되고 싶다고 했다.", "effects": S(talent=3)},
        {"key": "B", "text": "의사라고 한다", "hint": "지능 ↑", "result": "유진은 의사가 되고 싶다고 했다.", "effects": S(intel=3)},
        {"key": "C", "text": "늑대라고 한다", "hint": "???", "result": "선생님이 한참 웃었다.", "effects": S(happy=3, charm=1)},
    ]),
    E('c_pet', 'crossroad', 6, 12, '강아지를 키우고 싶다고 조른다.', cond={"noflags": ["pet"]}, weight=15, choices=[
        {"key": "A", "text": "키우게 해준다", "hint": "행복 ↑ 재산 ↓", "result": "작은 강아지가 식구가 됐다.", "effects": SA(add=["pet"], happy=5, wealth=-2)},
        {"key": "B", "text": "안 된다고 한다", "hint": "행복 ↓", "result": "유진은 밤새 삐졌다.", "effects": S(happy=-3)},
    ]),
    E('c_academy', 'crossroad', 9, 12, '친구들이 다 학원에 다닌다고 한다.', weight=18, choices=[
        {"key": "A", "text": "학원에 보낸다", "hint": "지능 ↑ 행복 ↓", "result": "학원 가방이 무거워졌다.", "effects": S(intel=4, happy=-2, wealth=-2)},
        {"key": "B", "text": "실컷 놀게 둔다", "hint": "행복 ↑ 매력 ↑", "result": "해 질 때까지 놀이터에 있었다.", "effects": S(happy=4, charm=1)},
    ]),
    E('c_phone', 'crossroad', 10, 13, '스마트폰을 사달라고 한다.', weight=15, choices=[
        {"key": "A", "text": "사준다", "hint": "행복 ↑ 지능 ↓", "result": "게임 앱이 열 개가 됐다.", "effects": SA(add=["game"], happy=3, intel=-1)},
        {"key": "B", "text": "아직 이르다", "hint": "지능 ↑ 행복 ↓", "result": "대신 책을 한 권 더 읽었다.", "effects": S(intel=2, happy=-2)},
    ]),
    E('c_club', 'crossroad', 13, 16, '동아리를 골라야 한다.', weight=20, choices=[
        {"key": "A", "text": "방송부", "hint": "끼 ↑", "result": "점심시간 교내 방송을 맡았다.", "effects": SA(add=["mic"], talent=3)},
        {"key": "B", "text": "축구부", "hint": "건강 ↑", "result": "매일 운동장을 뛰었다.", "effects": SA(add=["sporty"], health=3)},
        {"key": "C", "text": "독서부", "hint": "지능 ↑", "result": "책 냄새가 좋아졌다.", "effects": SA(add=["bookworm"], intel=3)},
    ]),
    # 어른·노년 갈림길
    E('c_scout', 'crossroad', 27, 50, '다른 회사에서 스카우트 제안이 왔다.', cond={"job": ["office", "programmer", "civil", "chef", "voice_actor"]}, weight=12, choices=[
        {"key": "A", "text": "옮긴다", "hint": "재산 ↑ 행복 ↓", "result": "연봉이 올랐다. 일도 늘었다.", "effects": S(wealth=6, happy=-2)},
        {"key": "B", "text": "남는다", "hint": "행복 ↑", "result": "익숙한 자리가 편했다.", "effects": S(happy=3)},
    ]),
    E('c_parents', 'crossroad', 40, 60, '부모님을 모시고 살지 고민 중이다.', weight=12, choices=[
        {"key": "A", "text": "모시고 산다", "hint": "행복 ↑ 재산 ↓", "result": "집이 다시 북적거렸다.", "effects": SA(add=["filial"], happy=3, wealth=-4)},
        {"key": "B", "text": "근처로 이사한다", "hint": "행복 ↑", "result": "주말마다 반찬을 들고 찾아갔다.", "effects": S(happy=2, wealth=-1)},
    ]),
    E('c_grandkid_care', 'crossroad', 58, 75, '자식이 손주를 봐달라고 한다.', cond={"flags": ["kid"]}, weight=15, choices=[
        {"key": "A", "text": "봐준다", "hint": "행복 ↑ 건강 ↓", "result": "손주 덕에 하루가 짧아졌다.", "effects": S(happy=5, health=-2)},
        {"key": "B", "text": "내 인생도 있다고 한다", "hint": "건강 ↑", "result": "대신 용돈을 두둑이 보냈다.", "effects": S(health=2, wealth=-3)},
    ]),
    E('c_will', 'crossroad', 76, 92, '유언장을 쓸까 고민 중이다.', weight=12, choices=[
        {"key": "A", "text": "쓴다", "hint": "마음 정리", "result": "하고 싶은 말을 꾹꾹 눌러 적었다.", "effects": S(happy=2), "diary": "고마운 사람이 생각보다 많았다."},
        {"key": "B", "text": "아직 멀었다", "hint": "행복 ↑", "result": "아직 할 게 많다며 웃었다.", "effects": S(happy=3)},
    ]),
    # 집중(5년 계획)과 연결된 이벤트
    E('f_toddler_book', 'daily', 1, 7, '그림책을 통째로 외워서 읽는 척을 했다.', S(intel=3, happy=1), cond=FX('read')),
    E('f_toddler_run', 'daily', 2, 7, '놀이터 미끄럼틀을 거꾸로 올라갔다.', S(health=3), cond=FX('outside')),
    E('f_toddler_song', 'daily', 2, 7, '동요를 개사해서 하루 종일 불렀다.', S(talent=3, happy=1), cond=FX('art')),
    E('f_toddler_play', 'daily', 1, 7, '진흙탕에서 놀다 와서 혼났다. 그래도 즐거웠다.', S(happy=3), cond=FX('play')),
    E('f_olympiad', 'daily', 10, 18, '교내 경시대회에서 상을 받았다.', S(intel=3, happy=2), cond=FX('study')),
    E('f_scholarship', 'daily', 15, 24, '장학금을 받았다.', S(wealth=4, intel=2), cond=FX('study', 'selfdev')),
    E('f_allnighter', 'daily', 13, 19, '시험 기간에 밤을 새웠다.', S(intel=2, health=-2), cond=FX('study'), once=False, weight=6),
    E('f_relay', 'daily', 8, 19, '운동회 대표 선수로 뽑혔다.', S(health=3, charm=2), cond=FX('sports')),
    E('f_teen_injury', 'daily', 10, 19, '운동하다 발목을 삐었다.', S(health=-3), cond=FX('sports', 'exercise'), once=False, weight=4),
    E('f_teen_party', 'daily', 10, 19, '친구들과 노래방에서 목이 쉴 때까지 놀았다.', S(happy=3, charm=1), cond=FX('friends'), once=False, weight=5),
    E('f_teen_popular', 'daily', 12, 19, '반에서 인기투표 1등을 했다.', S(charm=4, happy=2), cond=FX('friends')),
    E('f_contest', 'daily', 12, 50, '작은 대회에서 입상했다.', S(talent=4, happy=2), cond=FX('hobby', 'create')),
    E('f_busking', 'daily', 15, 40, '길거리 공연을 해봤다. 지나가던 사람이 박수를 쳐줬다.', SA(add=["music"], talent=3, charm=2), cond=FX('hobby', 'create')),
    E('f_teen_free', 'daily', 8, 19, '하고 싶은 걸 하며 방학을 보냈다.', S(happy=4), cond=FX('rest'), once=False, weight=5),
    E('f_marathon', 'daily', 20, 65, '마라톤 하프 코스를 완주했다.', S(health=3, happy=3), cond=FX('exercise')),
    E('f_gym_pr', 'daily', 20, 65, '헬스장에서 개인 기록을 깼다.', S(health=2, charm=1), cond=FX('exercise'), once=False, weight=4),
    E('f_blind_date', 'daily', 20, 45, '소개팅을 했다. 대화가 잘 통했다.', SA(add=["love"], happy=4), cond={"anyflags": ["focus_love"], "noflags": ["love"]}, weight=15),
    E('f_friends_trip', 'daily', 20, 60, '오랜 친구들과 여행을 갔다.', SA(add=["friend"], happy=5, wealth=-2), cond=FX('love'), once=False, weight=4),
    E('f_certificate', 'daily', 20, 60, '자격증 시험에 합격했다.', S(intel=3, wealth=2), cond=FX('selfdev'), once=False, weight=5),
    E('f_language', 'daily', 20, 60, '외국어를 배우기 시작했다.', SA(add=["language"], intel=3), cond=FX('selfdev')),
    E('f_promotion', 'daily', 26, 62, '승진했다.', S(wealth=6, happy=2), cond={"anyflags": ["focus_work"], "nojob": ["student"]}, once=False, weight=5),
    E('f_burnout', 'daily', 25, 60, '번아웃이 왔다. 아무것도 하기 싫었다.', S(happy=-6, health=-3), cond=FX('work'), weight=6),
    E('f_side_income', 'daily', 22, 60, '부업으로 쏠쏠한 돈을 벌었다.', S(wealth=4), cond=FX('work'), once=False, weight=4),
    E('f_first_fan', 'daily', 18, 60, '처음으로 팬레터를 받았다.', SA(add=["fan"], happy=5), cond=FX('create')),
    E('f_upload', 'daily', 18, 70, '만든 작품을 인터넷에 올렸다. 댓글이 세 개 달렸다.', S(talent=2, happy=2), cond=FX('create'), once=False, weight=5),
    E('f_lazy_week', 'daily', 20, 64, '일주일 내내 푹 쉬었다. 몸이 가벼워졌다.', S(happy=3, health=2), cond=FX('rest'), once=False, weight=5),
    E('f_walk_friend', 'daily', 65, 100, '산책길에서 동갑내기 친구를 사귀었다.', SA(add=["friend"], happy=4, charm=2), cond=FX('walk')),
    E('f_mountain', 'daily', 65, 90, '동네 뒷산 정상에 올랐다.', S(health=3, happy=2), cond=FX('walk'), once=False, weight=4),
    E('f_garden', 'daily', 60, 100, '텃밭에 상추를 심었다. 잘 자란다.', S(happy=3), cond=FX('hobby_old')),
    E('f_painting_old', 'daily', 65, 100, '문화센터에서 수채화를 배웠다.', S(talent=2, happy=2), cond=FX('hobby_old'), once=False, weight=4),
    E('f_family_dinner', 'daily', 60, 100, '온 가족이 모여 저녁을 먹었다.', S(happy=4), cond=FX('family'), once=False, weight=5),
    E('f_volunteer', 'daily', 60, 95, '동네 아이들에게 책을 읽어줬다.', S(charm=3, happy=2), cond=FX('volunteer'), once=False, weight=5),
    E('f_choir', 'daily', 60, 100, '합창단 공연에 섰다. 맨 뒷줄이었다.', S(talent=2, happy=3), cond=FX('choir'), once=False, weight=5),
    # 중년
    E('d_white_hair', 'daily', 38, 55, '거울을 보다 흰머리를 발견했다.', S(happy=-2)),
    E('d_class_reunion', 'daily', 30, 60, '동창회에 나갔다. 다들 많이 변했다.', S(charm=2, happy=2)),
    E('d_kid_school', 'daily', 33, 52, '아이가 초등학교에 입학했다.', S(happy=4, wealth=-2), cond={"flags": ["kid"]}, weight=12),
    E('d_kid_teen', 'daily', 42, 60, '사춘기 아이와 크게 다퉜다.', S(happy=-3), cond={"flags": ["kid"]}, weight=10),
    E('d_parent_sick', 'daily', 40, 65, '부모님이 편찮으셔서 병간호를 했다.', S(happy=-3, wealth=-3)),
    E('d_first_car', 'daily', 24, 45, '첫 차를 샀다.', S(wealth=-5, happy=4)),
    E('d_move', 'daily', 25, 70, '이사를 했다. 짐이 생각보다 많았다.', S(happy=1, wealth=-2), once=False, weight=3),
    E('d_back_pain', 'daily', 38, 75, '허리가 아프기 시작했다.', S(health=-3)),
    E('d_old_friend_call', 'daily', 30, 80, '오랜 친구에게 먼저 연락이 왔다.', S(happy=3), cond={"flags": ["friend"]}),
    E('d_pet_goodbye', 'daily', 15, 30, '강아지와 마지막 산책을 했다.', SA(remove=["pet"], happy=-5), cond={"flags": ["pet"]}, weight=8, diary='고마웠어. 많이 보고 싶을 거야.'),
    E('d_viral_post', 'daily', 20, 60, 'SNS에 올린 글이 소소하게 화제가 됐다.', S(charm=3, happy=2)),
    E('d_cooking_class', 'daily', 30, 60, '요리 학원에 등록했다.', SA(add=["cook"], happy=2, wealth=-1)),
    E('d_cold', 'daily', 20, 100, '독한 감기에 걸려 일주일을 앓았다.', S(health=-3), once=False, weight=3),
    # 노년
    E('d_reading_glasses', 'daily', 55, 80, '돋보기 안경을 맞췄다.', S(intel=1)),
    E('d_smartphone_lesson', 'daily', 65, 92, '손주에게 스마트폰 쓰는 법을 배웠다.', S(intel=2, happy=2), cond={"flags": ["kid"]}),
    E('d_late_love', 'daily', 65, 90, '노인정에서 마음 맞는 사람을 만났다.', SA(add=["love"], happy=6), cond={"noflags": ["married"]}, weight=8),
    E('d_long_cold', 'daily', 70, 100, '감기가 한 달이나 갔다.', S(health=-4), once=False, weight=4),
    E('d_memoir', 'daily', 68, 100, '자서전을 쓰기 시작했다.', S(intel=2, happy=2), diary='내 인생은 생각보다 재미있었다.'),
    E('d_old_stream', 'daily', 65, 100, '은퇴했지만 가끔 방송을 켠다. 양들은 아직 남아 있다.', S(happy=5), cond={"hadjob": ["vtuber"]}, weight=15,
      diary='오늘도 양들이 와줬다.'),
    E('d_hometown', 'daily', 60, 95, '어릴 적 살던 동네에 가봤다. 놀이터는 그대로였다.', S(happy=3)),
    E('d_80th', 'daily', 80, 80, '팔순 잔치를 했다.', S(happy=4), weight=30),
    E('d_lost_friend', 'daily', 70, 98, '오랜 친구를 먼저 떠나보냈다.', S(happy=-6), cond={"flags": ["friend"]}, diary='보고 싶다.'),
    E('d_bingo', 'daily', 65, 100, '경로당 빙고 대회에서 1등을 했다.', S(happy=3)),
    E('d_tv_contest', 'daily', 60, 90, '노래자랑 예선에 나갔다. 땡이었다.', S(happy=2, charm=1)),
]

# ── 5년 계획(집중) ──
FO = lambda id, name, a0, a1, yearly, side, hint, sort: dict(id=id, name=name, age_min=a0, age_max=a1, yearly=yearly, side=side, hint=hint, sort=sort)
focuses = [
    FO('play', '마음껏 놀기', 0, 7, {"happy": 2}, {"intel": -1}, '행복 ↑ · 지능 조금 ↓', 1),
    FO('read', '그림책 읽어주기', 0, 7, {"intel": 2}, {}, '지능 ↑', 2),
    FO('outside', '밖에서 뛰어놀기', 0, 7, {"health": 2}, {}, '건강 ↑', 3),
    FO('art', '노래·그림 놀이', 0, 7, {"talent": 2}, {}, '끼 ↑', 4),
    FO('study', '공부', 8, 19, {"intel": 2}, {"happy": -1}, '지능 ↑ · 행복 조금 ↓', 11),
    FO('sports', '운동', 8, 19, {"health": 2}, {}, '건강 ↑', 12),
    FO('friends', '친구', 8, 19, {"charm": 2}, {"intel": -1}, '매력 ↑ · 지능 조금 ↓', 13),
    FO('hobby', '취미·예체능', 8, 19, {"talent": 2}, {}, '끼 ↑', 14),
    FO('rest', '자유롭게', 8, 64, {"happy": 2}, {"wealth": -1}, '행복 ↑ · 재산 조금 ↓', 15),
    FO('work', '일·저축', 20, 64, {"wealth": 2}, {"happy": -1, "health": -1}, '재산 ↑ · 행복·건강 조금 ↓', 21),
    FO('exercise', '운동', 20, 64, {"health": 2}, {}, '건강 ↑', 22),
    FO('love', '연애·사람', 20, 64, {"charm": 2, "happy": 1}, {"wealth": -1}, '매력·행복 ↑ · 재산 조금 ↓', 23),
    FO('selfdev', '자기계발', 20, 64, {"intel": 2}, {"happy": -1}, '지능 ↑ · 행복 조금 ↓', 24),
    FO('create', '창작·방송', 15, 100, {"talent": 2}, {"wealth": -1}, '끼 ↑ · 재산 조금 ↓', 25),
    FO('walk', '산책', 65, 100, {"health": 2}, {}, '건강 ↑', 31),
    FO('hobby_old', '취미 생활', 65, 100, {"happy": 2}, {}, '행복 ↑', 32),
    FO('family', '가족과 시간', 65, 100, {"happy": 1, "charm": 1}, {}, '행복·매력 ↑', 33),
    FO('volunteer', '봉사', 65, 100, {"charm": 2}, {}, '매력 ↑', 34),
    FO('choir', '노래 교실', 65, 100, {"talent": 1, "happy": 1}, {}, '끼·행복 ↑', 35),
]

# ── 특수 엔딩 ──
SP = lambda id, title, text, cond, pr, hint: dict(id=id, title=title, text=text, cond=cond, priority=pr, hint=hint)
specials = [
    SP('wolf', '아무도 몰랐던 늑대 유진', '평생 사람인 척 살았지만, 마지막 보름달 아래서 유진은 원래 모습으로 돌아갔어요.', {"flags": ["wolf_dream3"]}, 100,
       '늑대 꿈을 끝까지 따라가면…'),
    SP('true_vtuber', '진짜 버튜버가 된 유진', '양들과 함께한 방송이 평생의 자랑이 됐어요.', {"job": ["vtuber"], "flags": ["yangs"], "min": {"happy": 60}}, 80,
       '방송을 놓지 않고, 팬들에게 이름을 붙여주면…'),
    SP('prodigal', '재벌가의 탕아 유진', '모든 걸 가지고 태어났지만, 모든 걸 잃고 떠났어요.', {"house": ["rich"], "max": {"wealth": 15}}, 70,
       '모든 걸 가지고 태어나 모든 걸 잃으면…'),
    SP('rags_riches', '단칸방에서 빌딩까지 올라간 유진', '단칸방 창문으로 보던 빌딩이 결국 유진의 것이 됐어요.', {"house": ["poor"], "min": {"wealth": 90}}, 70,
       '가장 낮은 곳에서 가장 높은 곳으로 가면…'),
]

sql = ['-- 유진 키우기 내용 전체(같은 id면 덮어씀). tools/life-content/gen_seed.py로 생성 — 직접 고치지 말고 생성기를 고칠 것.']
sql.append(upsert('life_jobs', ['id', 'name', 'category', 'cond', 'age_min', 'weight', 'yearly', 'hint'], jobs))
sql.append(upsert('life_modifiers', ['id', 'text', 'cond', 'priority', 'hint'], mods))
sql.append(upsert('life_finales', ['id', 'text', 'cond', 'priority'], fins))
sql.append(upsert('life_events', ['id', 'kind', 'age_min', 'age_max', 'cond', 'weight', 'once', 'text', 'effects', 'choices', 'diary', 'hint'], events))
sql.append(upsert('life_special_endings', ['id', 'title', 'text', 'cond', 'priority', 'hint'], specials))
sql.append(upsert('life_focuses', ['id', 'name', 'age_min', 'age_max', 'yearly', 'side', 'hint', 'sort'], focuses))
open(sys.argv[1] if len(sys.argv) > 1 else 'life_content.sql', 'w').write('\n\n'.join(sql) + '\n')
print(len(jobs), len(mods), len(fins), len(events), len(specials), len(focuses))
