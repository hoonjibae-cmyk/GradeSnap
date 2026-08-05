# 04. 데이터 모델

## 1. 개념 구조

```
academy ─┬─ teacher
         ├─ student ─── enrollment ─── class
         └─ exam_template ─┬─ template_page
                           ├─ question ─┬─ answer_region
                           │            └─ answer_key
                           └─ exam ─── submission ─┬─ submission_page
                                                   └─ item_result
```

**핵심 분리**: `exam_template`(시험지 양식·정답)과 `exam`(실제 시행 회차)을 분리합니다.
같은 단어 시험을 여러 반이 다른 날 보는 것이 일상이기 때문입니다.

## 2. 스키마

> Postgres 기준. 모든 테이블에 `created_at`, `updated_at` 포함(생략 표기).

### 조직·사용자

```sql
academy(id, name)
teacher(id, academy_id, email, name, role)        -- role: teacher | admin
student(id, academy_id, name, student_no, grade, school, phone)
class(id, academy_id, name, teacher_id, active)
enrollment(id, class_id, student_id, joined_at, left_at)
```

### 시험지 템플릿

```sql
exam_template(
  id, academy_id, created_by,
  name,                    -- '미강고1 1과 유&반의어 Test'
  code,                    -- QR에 들어가는 코드: 'MG-H1-U1-SYNANT-01'
  version,                 -- 좌표 수정 시 증가. 인쇄본과 템플릿 불일치 방지
  page_count,
  source_pdf_url,
  printable_pdf_url,       -- QR·마커 삽입본
  pass_rule,               -- jsonb: {"type":"max_wrong","value":3}
  auto_confirm_threshold,  -- 기본 0.9
  status                   -- draft | ready | archived
)

template_page(
  id, template_id, page_no,
  width_pt, height_pt,     -- 템플릿 좌표계 기준 크기
  fiducials,               -- jsonb: 기준 마커 4점 좌표
  preview_url
)
```

### 문항·답안 영역·정답

```sql
question(
  id, template_id, page_no,
  number,                  -- 시험지에 인쇄된 문항 번호 ('12', '서술형 2-A')
  type,                    -- choice | short_answer | sentence | essay | checkbox
  points        default 1,
  grading_unit  default 'question',  -- question | region  (B유형은 question)
  sort_order
)

answer_region(
  id, question_id, page_no,
  kind,                    -- mark | handwriting
  bbox,                    -- jsonb: {"x":0.12,"y":0.34,"w":0.20,"h":0.03}  (0~1 정규화)
  label,                   -- 'blank_1', 'choice_유', 'choice_반'
  prefix,                  -- 인쇄된 첫 글자 ('g' in "g̲uard") — 없으면 null
  multiline    default false,  -- 답안이 여러 줄로 넘칠 수 있는 영역
  sort_order
)

answer_key(
  id, question_id,
  exam_id,                 -- NULL이면 템플릿 소속(고정 정답), 값이 있으면 그 회차 전용
  canonical,               -- 대표 정답
  accepted        text[],  -- 인정 답안 ['응답하다','대답하다','반응하다']
  per_region      jsonb,   -- 빈칸별 정답 {"blank_1":"was","blank_2":"a"}
  rubric          jsonb,   -- 문장형 채점 기준 (아래 참조)
  match_options   jsonb    -- {"ignore_case":true,"ignore_space":true,
                           --  "allow_typo_distance":1,"ignore_punctuation":false}
)
```

`bbox`를 **0~1 정규화 좌표**로 저장하는 이유: 인쇄 배율·촬영 해상도가 달라도
템플릿 좌표계에서 동일하게 해석됩니다.

`answer_key.exam_id`는 **정답이 템플릿에 고정된 시험지**와
**양식만 재사용하고 매회 정답이 바뀌는 시험지**를 함께 다루기 위한 것입니다.
바로 아래에서 설명합니다.

---

## 2.5 시험지 3분류 — 등록·운영 비용이 다릅니다

이 학원의 시험지는 만들어지는 방식이 세 가지이고, 각각 **등록 빈도와 매회 작업량이
완전히 다릅니다.** 데이터 모델이 이 셋을 모두 감당해야 합니다.

| 분류 | 예시 | 본문 레이아웃 | 내용·정답 | 매회 작업 |
|---|---|---|---|---|
| **① 생성기 출력** | 유니크보카 | 매번 생성 | 매번 다름 | **없음** (자동) |
| **② 고정 세트** | 문법 백지 TEST | 고정 | **고정** | **없음** (유닛당 1회 등록) |
| **③ 매회 신규** | 영작클리닉, Day08-10 단어시험 | **매번 다름** | 매번 다름 | **매회 전체 등록** |

> ⚠️ ③에서 "템플릿"은 **상단 헤더 표**(반명·학생명·점수·컷트라인)만 가리킵니다.
> **본문에는 양식이 없습니다.** 선생님이 매회 직접 작성하므로 문항 수·배치·
> 답안 위치가 전부 달라집니다. **좌표를 재사용할 수 없습니다.**

### ① 생성기 출력
출제 시스템이 매번 새 시험지를 만듭니다. 문항 순서·좌표·정답이 전부 생성 시점에 정해지므로
`examSpec`을 받아 `exam_template`을 자동 생성합니다. → [09. 생성기 연동](09-yunique-voca-integration.md)

### ② 고정 세트 ← **운영 비용이 가장 낮습니다**

> ✅ 실물 확인 완료: 문법 백지 TEST는 **총 59개 유닛**(레벨 4종 × 챕터 14~16),
> 유닛마다 `시험지 / 정답지 / 형광펜 표시한 정답지` 3종이 갖춰져 있습니다.
> 시험지와 정답지의 레이아웃이 같아 **텍스트 차분으로 좌표와 정답을 동시에 추출**할 수 있습니다.
>
> ⚠️ 다만 **레벨마다 제작 방식이 달라 편차가 큽니다.** 실험 결과 Level High는
> 61개 정답이 깔끔히 추출된 반면, Level 3는 이미지 기반 PDF라 추출 불가,
> Level 2는 정답지가 비어 있었습니다. **59유닛 전수 진단이 선행되어야 합니다.**
> → [10 §9~10](10-pdf-extraction-findings.md#9-문법-백지-test-세트-조사-drive)

문법 백지 TEST처럼 **시험지 세트가 이미 완성되어 있고**, 선생님은 필요한 유닛을
골라 출력만 합니다. 내용도 정답도 바뀌지 않습니다.

```
answer_key.exam_id = NULL     -- 정답이 템플릿에 붙어 있음
```

**유닛당 딱 한 번만 등록하면 이후 운영 비용이 0입니다.**
매회 하는 일은 촬영·업로드뿐입니다.

> 문법 백지 TEST는 채점 난이도로는 D유형(어려움)이지만,
> **등록 비용이 일회성**이라는 점 때문에 실제 도입 가치는 훨씬 높습니다.
> 유닛 수가 유한하므로 초기에 한 번 등록해두면 영구적으로 쓸 수 있습니다.
> 세트 원본 파일(한글/워드/PDF)이 있으므로 좌표 등록도 원본 기준으로 정확하게 할 수 있습니다.

### ③ 매회 신규 ← **가장 흔하고, 가장 비용이 큽니다**

영작클리닉·Day08-10 단어시험처럼 **선생님이 매회 시험지를 새로 만드는** 경우입니다.
공유되는 것은 상단 헤더 표뿐이고 **본문은 매번 다릅니다.**

따라서 매회 `exam_template`을 새로 만들어야 합니다.
좌표도, 정답도, 문항 구조도 전부 새로 등록해야 합니다.

```
exam_template (7/23 M7B 영작클리닉)  ← 매회 새 템플릿
exam_template (7/30 M7B 영작클리닉)  ← 레이아웃이 다르므로 별개
```

**이 분류가 시스템의 생사를 가릅니다.**
등록에 걸리는 시간이 채점으로 아끼는 시간보다 길면 도입할 이유가 없습니다.

```
수기 채점            30장 × 1분         = 30분
자동채점 (등록 5분)  5 + 촬영 3 + 검수 5 = 13분   ← 도입 가치 있음
자동채점 (등록 20분) 20 + 3 + 5         = 28분   ← 도입 의미 없음
```

→ **템플릿 등록 5분 이내**를 핵심 목표 지표로 잡습니다.

#### 등록을 두 문제로 쪼갭니다

정답지는 존재하지만 **시험지 레이아웃과 무관한 번호별 나열 형태**입니다.
따라서 정답지에서 좌표는 얻을 수 없지만, **정답 텍스트는 통째로 얻을 수 있습니다.**

등록 작업은 사실상 두 가지이고, 둘을 분리하면 각각 훨씬 쉬워집니다.

| 문제 | 해법 | 예상 소요 |
|---|---|---|
| **정답 입력** | 정답지를 **붙여넣기** → 번호별 파싱 | 10초 |
| **좌표 지정** | 문항 번호 OCR + 답안 영역 자동 검출 | 30초 + 보정 |

#### 🟢 정답 — 붙여넣기로 끝냅니다

정답지가 이미 `1. household / 2. mature / ...` 형태로 있으므로,
그대로 복사해 붙여넣으면 됩니다. 수기 입력이 아닙니다.

파서는 **관대하게** 만듭니다. 선생님마다 형식이 다를 것이기 때문입니다.

```
1. household        1) household       1 household
2. mature           2) mature          2 mature
```
- 구분자: `.` `)` `:` 공백 탭 쉼표 모두 허용
- 여러 열로 나열된 경우 열 단위로 분해
- 한 문항에 복수 정답: `3. respond / reply` → 인정 답안 다중 등록
- 파싱 결과를 **표로 미리보기**해서 선생님이 눈으로 확인

#### 🟢 좌표 — 문항 번호 OCR이 열쇠입니다

답안 영역만 검출하면 "몇 번 문항의 답안인지"를 알 수 없습니다.
그런데 **문항 번호는 인쇄 활자**입니다. 손글씨가 아니므로 OCR 정확도가 사실상 100%입니다.

```
1. 시험지 PDF 렌더
2. 인쇄된 문항 번호 OCR  → "1", "2", ... "50"의 위치 확보
3. 각 번호의 오른쪽·아래에서 답안 영역 검출 (밑줄 / 셀 테두리 / 여백)
4. 번호 ↔ 영역 매칭
```

2단·4단 레이아웃에서 번호 순서가 헷갈리는 문제도 이걸로 해결됩니다.
좌표 순서로 추측하지 않고 **인쇄된 번호를 그대로 읽기** 때문입니다.

#### 🟢 개수 대조 — 자동 검출의 안전장치

정답 목록과 검출 결과의 **개수가 맞는지 대조**합니다.
이게 자동 검출의 신뢰성을 보완하는 핵심 장치입니다.

```
정답 50개  ↔  검출된 문항 50개   → ✅ 통과, 바로 저장
정답 50개  ↔  검출된 문항 48개   → ⚠️ 누락된 번호(23, 41)만 표시하고 수동 지정
```

**전부 확인시키지 않고, 어긋난 것만 보여줍니다.** 이게 5분과 30분을 가릅니다.

> ❓ **확인 필요**: 정답지의 실제 형식.
> 파일 형태(한글/워드/엑셀/텍스트), 번호와 정답의 배치, 여러 열 사용 여부.
> **샘플 한두 개만 주시면 파서를 그에 맞게 만들 수 있습니다.**

#### 🟢 헤더 템플릿의 가치 — 마커와 QR을 심을 자리

본문 좌표는 재사용할 수 없지만, **공통 헤더는 그 자체로 큰 가치가 있습니다.**

헤더 템플릿에 기준 마커 4개와 QR 자리를 **한 번만** 추가하면,
그 헤더를 쓰는 **모든 시험지가 자동으로 정합 가능해집니다.**
선생님은 평소처럼 헤더를 복사해 쓰기만 하면 되고, 아무것도 바꿀 필요가 없습니다.

| 헤더에서 얻는 것 | 용도 |
|---|---|
| 기준 마커 4개 | 정합 (모든 시험지 공통) |
| QR 자리 | 시험지 식별 |
| 학생 이름란 (위치 고정) | 학생 식별 자동화 |
| 컷트라인 칸 (위치 고정) | PASS 기준 자동 추출 |

**투자 대비 효과가 가장 큰 조치입니다.** 헤더 파일 하나만 고치면 됩니다.

### 채점 시 정답 조회 순서
```sql
-- 회차 전용 정답이 있으면 그것을, 없으면 템플릿 고정 정답을 사용
COALESCE(
  (SELECT ... FROM answer_key WHERE question_id = ? AND exam_id = ?),
  (SELECT ... FROM answer_key WHERE question_id = ? AND exam_id IS NULL)
)
```
③은 매회 새 템플릿이므로 실질적으로 `exam_id IS NULL` 경로만 씁니다.
`exam_id`는 향후 **같은 시험지를 여러 반이 다른 정답 기준으로 채점**하는 경우
(부분점수 기준을 반별로 다르게 두는 등)를 위해 남겨둡니다.

### 시행·제출·결과

```sql
exam(
  id, template_id, class_id, teacher_id,
  name, exam_date,
  status                   -- open | grading | closed
)

submission(
  id, exam_id, student_id,
  status,                  -- uploaded | processing | needs_review | confirmed | failed
  score, max_score, wrong_count,
  passed        boolean,
  auto_ratio    numeric,   -- 자동 확정 비율 (시스템 성능 추적용)
  graded_at, confirmed_at, confirmed_by
)

submission_page(
  id, submission_id, page_no,
  raw_image_url, warped_image_url,
  homography    jsonb,
  quality       jsonb,     -- {"blur":0.82,"markers_found":4,"skew_deg":1.2}
  status
)

item_result(
  id, submission_id, question_id,
  crop_urls     text[],    -- region별 잘라낸 이미지
  recognized    jsonb,     -- {"blank_1":{"text":"was","conf":0.94}, ...}
  verdict,                 -- correct | wrong | partial | needs_review
  score         numeric,
  confidence    numeric,   -- 0~1
  engine,                  -- omr | dict_match | ai
  ai_reason     text,      -- 검수 화면에 그대로 노출
  ai_checklist  jsonb,     -- E유형 조건 충족 체크리스트
  teacher_verdict,         -- 교사 최종 판정 (있으면 항상 우선)
  teacher_note, reviewed_by, reviewed_at
)
```

`item_result`는 **AI 판정과 교사 판정을 별도 컬럼으로 보존**합니다.
덮어쓰지 않는 이유: 두 값의 차이가 곧 시스템 정확도 지표이며,
이 데이터가 임계값 조정과 프롬프트 개선의 유일한 근거이기 때문입니다.

### 작업 큐

```sql
job(
  id, kind,                -- preprocess | grade | export
  payload jsonb,
  status,                  -- queued | processing | done | failed
  attempts, last_error,
  locked_at, locked_by,
  run_after timestamptz
)
```

워커는 `SELECT ... FOR UPDATE SKIP LOCKED`로 잡을 집습니다.
`locked_at`이 오래된 잡은 크래시로 간주해 재큐잉합니다(멱등 처리 전제).

## 3. 템플릿 JSON 예시

A유형(유&반의어) 1~2번 문항 부분:

```json
{
  "code": "MG-H1-U1-SYNANT-01",
  "name": "미강고1 1과 유&반의어 Test",
  "version": 3,
  "pass_rule": { "type": "max_wrong", "value": 3 },
  "auto_confirm_threshold": 0.9,
  "pages": [
    { "page_no": 1, "width_pt": 595, "height_pt": 842,
      "fiducials": [[0.05,0.04],[0.95,0.04],[0.05,0.96],[0.95,0.96]] }
  ],
  "questions": [
    {
      "number": "1", "type": "choice", "points": 1, "page_no": 1,
      "regions": [
        { "label": "choice_유", "kind": "mark", "bbox": {"x":0.075,"y":0.182,"w":0.030,"h":0.018} },
        { "label": "choice_반", "kind": "mark", "bbox": {"x":0.112,"y":0.182,"w":0.030,"h":0.018} }
      ],
      "key": { "canonical": "유" }
    },
    {
      "number": "1-뜻", "type": "short_answer", "points": 1, "page_no": 1,
      "regions": [
        { "label": "meaning", "kind": "handwriting", "bbox": {"x":0.150,"y":0.178,"w":0.290,"h":0.026} }
      ],
      "key": {
        "canonical": "응답하다",
        "accepted": ["대답하다", "반응하다", "응하다"],
        "match_options": { "ignore_space": true, "allow_typo_distance": 1 }
      }
    }
  ]
}
```

B유형(본문 빈칸) 문항 예시 — 한 문항에 빈칸 여러 개:

```json
{
  "number": "6", "type": "short_answer", "points": 1,
  "grading_unit": "question",
  "regions": [
    { "label": "blank_1", "kind": "handwriting", "bbox": {"x":0.21,"y":0.33,"w":0.09,"h":0.022} },
    { "label": "blank_2", "kind": "handwriting", "bbox": {"x":0.42,"y":0.33,"w":0.07,"h":0.022} },
    { "label": "blank_3", "kind": "handwriting", "bbox": {"x":0.58,"y":0.33,"w":0.11,"h":0.022} }
  ],
  "key": {
    "per_region": { "blank_1": "Korea", "blank_2": "was", "blank_3": "famous" },
    "match_options": { "ignore_case": true, "allow_typo_distance": 0 }
  }
}
```

단어시험 "한글 뜻 → 영단어" 문항 — **인쇄된 첫 글자가 칸 안에 있는 경우**:

```json
{
  "number": "28", "type": "short_answer", "points": 1,
  "regions": [
    { "label": "answer", "kind": "handwriting",
      "prefix": "g",
      "bbox": {"x":0.62,"y":0.21,"w":0.28,"h":0.024} }
  ],
  "key": {
    "canonical": "guard",
    "match_options": { "ignore_case": true, "allow_typo_distance": 0 }
  }
}
```

`prefix`가 있으면 crop 안에 활자와 손글씨가 섞여 있다는 뜻입니다.
인식 결과를 `prefix + 손글씨`로 조립해 `canonical`과 비교합니다.
**첫 글자가 확정되어 있어 오히려 인식 정확도가 올라가는 케이스입니다.**

C유형(문장 영작) 채점 기준 — **`multiline` 주의**:

```json
{
  "number": "4", "type": "sentence", "points": 2,
  "regions": [
    { "label": "sentence", "kind": "handwriting", "multiline": true,
      "bbox": {"x":0.10,"y":0.44,"w":0.82,"h":0.11} }
  ],
  "key": {
    "canonical": "This book is about King Sejong, who invented Hangeul.",
    "rubric": {
      "word_omission":   "wrong",
      "tense_error":     "wrong",
      "relative_pronoun_error": "wrong",
      "word_order_error":"wrong",
      "article_error":   "wrong",
      "comma_missing":   "correct",
      "capitalization":  "correct",
      "spelling_1char":  "review"
    }
  }
}
```

문장형 영역의 `bbox`는 **인쇄된 답안선 1줄이 아니라 다음 문항 번호 직전까지의 블록 전체**로
잡습니다. 실제 답안지에서 긴 영작은 2~3줄로 넘치며, 줄 수가 학생마다 다릅니다.
문장형은 어차피 VLM이 이미지 전체를 읽으므로 넉넉한 영역이 안전합니다.

## 4. 인덱스·제약

- `answer_key(question_id, exam_id)` UNIQUE (NULLS NOT DISTINCT) — 문항당 정답 1개 보장
- `item_result(submission_id, question_id)` UNIQUE — 재채점 시 UPSERT로 멱등 보장
- `submission(exam_id, student_id)` UNIQUE — 같은 학생 중복 업로드 방지(재촬영은 UPDATE)
- `item_result(verdict) WHERE verdict = 'needs_review'` 부분 인덱스 — 검수 큐 조회용
- `job(status, run_after)` — 워커 폴링용
- `exam_template.code` + `version` 조합으로 QR 해석 (구버전 인쇄본이 섞여 들어오는 사고 방지)

## 5. 접근 통제 (RLS)

```
teacher  : 본인이 담당하는 class의 exam / submission만
admin    : 소속 academy 전체
worker   : service role (RLS 우회)
```
