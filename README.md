# 내친소 · 좁은 세상, 좋은 사람

초대로 연결된 주선자가 지인의 소개를 작성하고, 지인이 내용을 직접 수정·검토한 뒤 공개를 승인해 인연을 찾는 서비스입니다. 한 회원이 주선자와 소개받는 역할을 모두 사용할 수 있습니다. AI는 입력한 특징으로 소개글 초안을 작성하며 자동으로 공개하지 않습니다.

**배포 URL: 아직 확인되지 않음.** 로컬 구현과 자동 테스트를 완료했고 호스팅 Supabase에는 006까지 적용했습니다. 실제 AI 호출과 Vercel 배포 검증은 대기 중이므로 과제 제출 완료 상태는 아닙니다.

개발 브랜치: [codex/naechinso-service](https://github.com/ssebni/cody_A1_3/tree/codex/naechinso-service).

## 구현 내용

- 초대 코드 가입·로그인·로그아웃, 서버 토큰 및 활성 회원 확인
- 30일 유효·1회용 초대 발급, 최대 10자 메모·미사용 초대 삭제, DB 트랜잭션을 통한 코드 소진 및 프로필 연결
- 지인 프로필 작성, 당사자 직접 수정·공개 승인·비공개 전환, 수정 시 재승인
- 홈·둘러보기·AI 소개글·지인 등록·마이페이지의 독립 화면 전환
- 본명·출생년월 기반 나이·고향·거주지·직업·키·종교·MBTI·200자 소개글과 비공개 사진 앨범(최대 3장)
- 공개 프로필 탐색·2촌/3촌 필터, 서버에서 초대 관계 거리 계산
- 매칭 요청·수락·거절·취소, 자기 자신과 진행 중인 쌍의 중복 요청 차단
- 매칭 성사 후 양측 연락 방법 공개
- Gemini API 소개글 생성, 빈 입력·시간 초과·제공자 오류·호출 제한 처리
- 모바일·태블릿·데스크톱 반응형 및 키보드 탭 이동

## 기술과 구조

프론트엔드는 프레임워크 없는 HTML/CSS/JavaScript입니다. `package.json`의 Node 패키지는 테스트 도구이며 프론트엔드 프레임워크가 아닙니다.

```text
index.html                 홈 / 둘러보기 / AI 소개글 / 지인 등록 / 마이페이지
css/style.css              반응형 스타일
js/auth.js                 Supabase 로그인·가입 화면
js/session.js              세션 공유, Bearer 인증 fetch, 시간 제한
js/app.js                  프로필·승인·매칭·AI 화면
js/config.js               공개 Supabase URL 및 publishable key
api/index.py               Python FastAPI, Vercel 서버 진입점
supabase/migrations/       초기 스키마와 원자적 서비스 함수
tests/                     Python API / PostgreSQL / 브라우저 테스트
docs/                      기획·데이터 설계·설정·검증·증빙
```

## 로컬 실행 (Windows PowerShell)

Python 3.12 이상이 필요합니다. 저장소에 과거 커밋된 `.venv`는 다른 운영체제용이므로 재사용하지 마세요.

```powershell
python -m venv .venv-win
.\.venv-win\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
# .env를 편집한 다음 실행
.\.venv-win\Scripts\python.exe -m uvicorn api.index:app --reload --port 8000
```

[로컬 서비스](http://127.0.0.1:8000)에서 확인합니다. `python -m http.server`는 Python API를 실행하지 않으므로 이 프로젝트의 전체 동작 확인에 사용하지 않습니다.

macOS/Linux에서는 `python3 -m venv .venv` 후 `.venv/bin/python`으로 위 pip·uvicorn 명령을 실행합니다.

## 환경 변수

| 변수 | 설정 위치·내용 |
|---|---|
| `SUPABASE_URL` | Supabase 프로젝트 URL. `js/config.js`와 같은 프로젝트 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 서버용 service_role 키. 브라우저에 넣지 않음 |
| `GEMINI_API_KEY` | Google AI Studio에서 발급한 서버용 Gemini API 키 |
| `GEMINI_MODEL` | AI Studio 프로젝트에서 사용할 수 있는 Gemini 텍스트 모델 ID |

로컬은 `.env`, 배포는 Vercel 프로젝트의 Environment Variables에 설정합니다. 키 값은 README·스크린샷·대화에 넣지 않습니다. `.env`는 Git과 Vercel 업로드에서 제외됩니다. 브라우저의 `js/config.js`에는 공개용 publishable key만 둡니다.

AI는 회원별 UTC 하루 10회, 최소 15초 간격으로 호출합니다. 제공자 실패도 시도 횟수에 포함됩니다. 초대는 하루 10회/5초 간격, 매칭 요청은 하루 20회/3초 간격입니다. DB에 기록하므로 서버 인스턴스가 바뀌어도 제한이 유지됩니다. Gemini 과금·프로젝트 예산은 Google AI Studio에서 별도로 관리합니다.

## Supabase 준비

1. 새 DB에서만 `supabase/migrations/001_initial_schema.sql`을 실행합니다. 이미 테이블이 있다면 다시 실행하지 않습니다.
2. `supabase/migrations/002_service_functions.sql`부터 `006_owner_profile_edit.sql`까지 번호 순서대로 SQL Editor에서 실행합니다. 005는 상세 프로필과 비공개 사진 저장소를, 006은 당사자 직접 수정 권한을 추가합니다.
3. 최초 운영자 계정을 Supabase Authentication에서 만든 뒤, 같은 UUID로 활성 `members` 행을 생성합니다. [상세 안내](docs/setup-and-deploy.md)를 참고하세요.
4. 일반 회원은 웹의 초대 가입만 사용합니다. Supabase Auth 계정만 만든 사용자는 회원 API에 접근할 수 없습니다.

기존 가입 구현과 동일하게 초대 가입 API는 이메일을 자동 확인 처리합니다. 이메일 소유권을 실제로 검증하는 메일 인증·비밀번호 재설정 흐름은 아직 구현하지 않았습니다. 성인 확인도 자가 확인이며 본인 인증이 아닙니다. 초대받은 성인 테스트 참여자 대상의 과제 MVP 범위입니다.

## 이용 흐름

1. 주선자가 로그인 → 마이페이지 ‘맺어주기’ → 초대 코드 발급·복사
2. ‘지인 프로필 준비하기’에서 해당 초대를 선택해 소개 저장 (AI 초안 사용 가능)
3. 지인에게 코드 전달 → 지인이 가입 (프로필은 가입 전·후 모두 작성 가능)
4. 지인이 ‘인연찾기’에서 자신의 소개를 검토·직접 수정하고 공개 승인
5. 서로 프로필이 공개된 두 회원이 연락 방법 저장 → 요청·수락
6. 매칭 성사 후 상대 연락 방법 확인

초대 하나는 한 사람의 프로필에만 연결됩니다. 초대 코드는 해시로 저장되어 새로고침 후 원문을 복구할 수 없습니다. 최대 10자 메모는 나중에도 수정할 수 있고, 아직 가입이나 프로필에 사용되지 않은 초대만 삭제할 수 있습니다. 가입이 완료된 초대도 원래 초대한 사람이 프로필을 연결할 수 있습니다. 저장된 소개는 당사자의 공개 승인을 기다립니다.

## Vercel 배포

1. 변경 코드를 GitHub 저장소에 커밋·푸시합니다.
2. Vercel에서 저장소를 Import하고 루트 디렉터리를 이 프로젝트로 선택합니다.
3. Framework Preset은 FastAPI이며 Vercel이 지원하는 표준 진입점 `api/index.py`의 `app`을 사용합니다. 별도 프론트 빌드는 없습니다.
4. 위 환경 변수 4개를 배포 대상 환경(Production/Preview)에 등록합니다.
5. Deploy 후 `/api/health`, 로그인, 두 테스트 회원의 공개 승인·매칭, 실제 AI 호출을 확인합니다.
6. 실제 URL을 README에 기록하고 실제 동작 화면을 캡처합니다. 키·DB 설정을 바꿨다면 재배포합니다.

설정 근거: [Vercel FastAPI 배포](https://vercel.com/docs/frameworks/backend/fastapi), [Gemini 텍스트 생성](https://ai.google.dev/gemini-api/docs/generate-content/text-generation). 배포 설정은 문서 기준으로 준비했으며 원격 배포 성공은 아직 검증하지 않았습니다.

## 테스트

```powershell
.\.venv-win\Scripts\python.exe -m pip install pytest
.\.venv-win\Scripts\python.exe -m pytest -q
npm ci
npm run test:db
# 다른 터미널에서 로컬 uvicorn 서버를 실행한 상태로:
npm run test:browser
```

브라우저 테스트는 설치된 Microsoft Edge를 사용합니다. 다른 환경은 `tests/browser.mjs`의 launch 옵션을 변경하고 Playwright Chromium을 설치하세요. PGlite는 로컬 PostgreSQL 엔진으로 SQL 함수와 권한을 검증합니다. 실제 Supabase의 여러 연결을 통한 동시성 검증은 별도입니다.

현재 검증: API 41개 통과, DB 17개 시나리오 통과, 브라우저 390/768/1440px와 주요 상호작용 통과. 외부 인증·AI 응답과 사진 저장소는 테스트에서 대체했습니다. [검증 기록](docs/verification.md).

## 제출 자료

- [서비스 기획서](docs/service-plan.md)
- [데이터·API 설계](docs/data-design.md)
- [설정과 배포 안내](docs/setup-and-deploy.md)
- [스크린샷 설명](docs/evidence/README.md): 로컬 화면 및 **모의 응답** UI 캡처
- [AI 코딩 도구 사용 기록](docs/ai-coding-log.md): 실제 작업 요약. 이 대화의 공유 링크 또는 스크린샷을 추가해 제출

남은 항목: 실제 배포 URL, 호스팅 환경의 전체 인증·동시성 검증, 실제 AI 성공 캡처, 원본 대화 증빙. 모의 AI 캡처를 실제 API 동작 증빙으로 제출하면 안 됩니다.
