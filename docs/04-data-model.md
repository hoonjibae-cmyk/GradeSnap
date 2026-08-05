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

| 분류 | 예시 | 레이아웃 | 내용·정답 | 최초 등록 | 매회 작업 |
|---|---|---|---|---|---|
| **① 생성기 출력** | 유니크보카 | 매번 생성 | 매번 다름 | 없음(자동) | **없음** |
| **② 고정 세트** | 문법 백지 TEST | 고정 | **고정** | 유닛당 1회 | **없음** |
| **③ 양식 재사용** | 영작클리닉, Day08-10 단어시험 | 고정 | 매회 다름 | 양식당 1회 | **정답 입력** |

### ① 생성기 출력
출제 시스템이 매번 새 시험지를 만듭니다. 문항 순서·좌표·정답이 전부 생성 시점에 정해지므로
`examSpec`을 받아 `exam_template`을 자동 생성합니다. → [09. 생성기 연동](09-yunique-voca-integration.md)

### ② 고정 세트 ← **운영 비용이 가장 낮습니다**
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

### ③ 양식 재사용
영작클리닉, Day08-10 단어시험처럼 **양식(레이아웃)만 정해져 있고 내용은 선생님이
매회 채워 넣는** 경우입니다. 문항 수와 답안 위치는 그대로지만 문제와 정답이 바뀝니다.

```
exam_template            -- 양식: 좌표·문항 구조 (한 번 등록, 계속 재사용)
  └─ exam (7/23 M7B)
       └─ answer_key.exam_id = <그 회차>   -- 정답만 회차별로
  └─ exam (7/30 M7B)
       └─ answer_key.exam_id = <그 회차>
```

**좌표는 다시 잡지 않습니다.** 선생님이 매회 하는 일은 정답표 입력뿐입니다.

> ⚠️ 전제: 선생님이 내용을 채울 때 **문항 수와 줄 수를 바꾸지 않아야** 좌표가 유지됩니다.
> 영작클리닉(10문항), Day08-10(50문항 2단)은 고정이므로 안전합니다.
> 문항 수가 달라지면 새 양식으로 등록하거나 자동 검출로 좌표를 다시 잡습니다.
> 업로드 시 **검출된 답안 영역 수와 템플릿 문항 수를 대조**해 불일치를 경고합니다.

### 채점 시 정답 조회 순서
```sql
-- 회차 전용 정답이 있으면 그것을, 없으면 템플릿 고정 정답을 사용
COALESCE(
  (SELECT ... FROM answer_key WHERE question_id = ? AND exam_id = ?),
  (SELECT ... FROM answer_key WHERE question_id = ? AND exam_id IS NULL)
)
```

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
