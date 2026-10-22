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
    E('d_walk', 'daily', 60, 100, '매일 아침 동네 한 바퀴를 걸었다.', S(health=2, happy=1), once=False, weight=6),
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

sql = ['-- 유진 키우기 첫 내용 묶음(초안 1차). 같은 id면 덮어씀 — 이 파일만 고쳐서 다시 적용하면 됨. (생성: gen_seed.py)']
sql.append(upsert('life_jobs', ['id', 'name', 'category', 'cond', 'age_min', 'weight', 'yearly', 'hint'], jobs))
sql.append(upsert('life_modifiers', ['id', 'text', 'cond', 'priority', 'hint'], mods))
sql.append(upsert('life_finales', ['id', 'text', 'cond', 'priority'], fins))
sql.append(upsert('life_events', ['id', 'kind', 'age_min', 'age_max', 'cond', 'weight', 'once', 'text', 'effects', 'choices', 'diary', 'hint'], events))
sql.append(upsert('life_special_endings', ['id', 'title', 'text', 'cond', 'priority', 'hint'], specials))
open(sys.argv[1] if len(sys.argv) > 1 else 'life_content.sql', 'w').write('\n\n'.join(sql) + '\n')
print(len(jobs), len(mods), len(fins), len(events), len(specials))
