# 데이터·API 설계

## 데이터

`001_initial_schema.sql`은 members/invitations/profiles/matches 초기 스키마입니다.
`002_service_functions.sql`은 회원 성인 확인 시각, contact_shares, usage_limits 및 서비스 RPC를 추가합니다.
`003_profiles_after_signup.sql`은 가입 완료 후에도 초대한 사람이 프로필을 연결할 수 있게 합니다.
`004_invitation_management.sql`은 초대 메모와 미사용 초대 삭제 RPC를 추가합니다.
`005_profile_details_and_photos.sql`은 상세 프로필 필드, 사진 메타데이터와 비공개 Storage 버킷을 추가합니다. `006_owner_profile_edit.sql`은 프로필 당사자에게 본인 프로필과 사진 수정 권한을 부여합니다.

| 데이터 | 규칙 |
|---|---|
| members | Supabase Auth UUID와 연결. active 회원만 기능 사용. invited_by로 초대 관계 보존 |
| invitations | 코드 SHA-256 해시, 30일 만료, 1회 사용, 최대 10자 메모, 가입·프로필 연결 전 삭제 가능 |
| profiles | 본명, 출생년월, 고향, 현재 거주지, 취미, 직업, 키, 종교, MBTI, 200자 소개. 작성자와 당사자는 수정, 당사자는 공개 승인 |
| profile_photos | 프로필당 최대 3장. 실제 파일은 비공개 `profile-photos` 버킷, DB에는 경로와 순서만 저장 |
| matches | pending→accepted/declined/cancelled. 본인 요청 금지, 진행 중인 두 회원 쌍은 유일 |
| contact_shares | 회원별 연락 방법. 본인과 수락 완료된 활성 상대에게만 반환 |
| usage_limits | 회원·기능·UTC 날짜별 시도 횟수와 최종 시각, 원자적 증가 |

## 접근 권한과 트랜잭션

모든 테이블은 RLS 활성, anon/authenticated 직접 접근 금지입니다. RPC 실행도 service_role만 허용합니다. Python이 Bearer 토큰을 Supabase Auth에 보내 사용자 UUID를 확인하고 활성 회원을 조회합니다. 클라이언트가 전달한 작성자 ID는 허용하지 않습니다.

`finish_join`은 초대 행을 `FOR UPDATE`로 잠그고 유효성 검사·회원 생성·초대 소진·프로필 소유자 연결을 한 트랜잭션으로 처리합니다. Supabase Auth 계정 생성은 외부 단계라 같은 트랜잭션이 아닙니다. SQL이 명확하게 거부하면 생성한 Auth 계정을 삭제하고, 응답 시간 초과처럼 커밋 여부가 모호하면 삭제하지 않고 운영자 확인용 UUID만 기록합니다.

공개 승인과 프로필 수정은 같은 프로필 행을 잠급니다. 승인 시 화면에서 읽은 updated_at과 DB 버전을 비교하므로 최신 내용을 읽지 않고 승인할 수 없습니다. 주선자나 당사자가 수정하면 승인 시각을 지우고 pending/draft로 전환합니다.

매칭은 공개 프로필과 저장된 연락 방법을 확인합니다. 요청은 요청자의 공유 동의, 수락은 수신자의 공유 동의입니다. 중복 쌍은 DB unique index, 상태 전이는 행 잠금으로 보호합니다. 공개 프로필 잠금은 ID 순으로 수행합니다. 이미 accepted인 매칭은 일방의 이후 프로필 숨김으로 취소되지 않으며 동의한 상대와 연락처 공유를 유지합니다. 회원 정지 시에는 상대의 연락처 조회에서 정지된 회원 연락처를 제외합니다.

## API

| 메서드·경로 | 입력·출력 |
|---|---|
| POST /api/verify_invite | email/password/display_name/invitation_code/adult_confirmed → ok; 공개 엔드포인트 |
| GET /api/state | 본인 정보, 공개 프로필과 촌수, 내 프로필, 작성 프로필, 초대 상태, 관련 매칭, 내 연락처 |
| POST /api/invitations | memo(최대 10자) → id/code/memo/expires_at (원문은 이때만 반환) |
| POST /api/invitation-memo | id/memo(최대 10자) → ok |
| POST /api/invitation-delete | id → ok; 가입·프로필 연결 전만 허용 |
| POST /api/profile | id 또는 invitation_id와 상세 프로필 필드 → id |
| POST /api/profile-photo | profile_id/file(JPG·PNG·WebP, 긴 변 1600px·약 1.5MB 이하로 브라우저에서 최적화) → id/position |
| POST /api/profile-photo-delete | id → ok |
| POST /api/profile-approval | id/publish/version → ok |
| POST /api/contact | contact_value → ok |
| POST /api/matches | recipient_id → id |
| POST /api/match-response | id/status(accepted/declined/cancelled) → ok |
| POST /api/introduction | notes(20~1000자) → introduction |
| GET /api/health | ok; 공개 상태 확인 |

공통 오류는 `{ "error": { "code": "...", "message": "한국어 안내" } }`입니다.
400 입력, 401 로그인, 403 권한, 409 상태 충돌, 413 큰 요청, 429 제한, 502 외부 실패, 503 설정/DB 실패, 504 시간 초과.
API 응답에는 `Cache-Control: no-store`를 설정합니다. 인증은 Authorization 헤더이고 API에 인증 쿠키를 쓰지 않습니다. CORS 허용을 추가하지 않아 타 출처에서 인증 API를 호출할 수 없습니다.

## 관계 거리와 AI

초대 관계는 방향 없는 그래프로 계산합니다. Python BFS가 로그인 회원에서 최단 거리를 구한 뒤 숫자만 반환합니다. 중간 회원 ID, 이름, 초대 ID는 공개 프로필 응답에서 제거합니다. 연결이 없으면 distance=null입니다.

Gemini Generate Content API에 메모와 시스템 작성 지침을 전달합니다. 출력 토큰 상한 400, 제공자 요청 시간 제한 25초입니다. 정상 종료 상태와 텍스트 유무를 확인하고 차단·불완전 응답은 오류로 반환합니다. 소개글은 화면에서 수정 가능하고 자동 저장/공개하지 않습니다. 입력 길이는 서버에서도 검사합니다.
