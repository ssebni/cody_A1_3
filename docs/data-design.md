# 데이터 및 API 설계 초안

영구 저장소는 관계형 DB를 사용한다. 인증 제공자 및 DB 제품은 구현 단계에서 선택한다. 비밀번호 인증은 직접 구현하지 않고 검증된 인증 서비스를 사용한다. 프론트는 순수 HTML/CSS/JS, 서버는 api/ 아래 Python 함수로 구성한다.

## 데이터 모델
| 테이블 | 주요 필드 | 규칙 |
|---|---|---|
| members | id, auth_subject, display_name, invited_by, created_at | invited_by는 members.id 참조, 가입 후 변경 금지, 최초 회원만 NULL |
| invitations | id, code_hash, inviter_id, expires_at, used_by, used_at | 코드 원문 대신 해시 저장, 1회 사용, 충분히 무작위인 코드 |
| profiles | id, owner_id, author_id, nickname, age_band, region, hobbies, introduction, status, approved_at | 상태 draft/pending/published/hidden, 공개 결정은 owner만 가능 |
| matches | id, requester_id, recipient_id, status, created_at, updated_at | pending/accepted/declined/cancelled, 본인 요청 금지, 회원 쌍별 진행 중 중복 금지 |
| contact_shares | member_id, contact_method, contact_value | 프로필 탐색 응답에 포함하지 않음, 수락된 상대에게만 반환 |

실제 지인의 프로필 초안은 초대 건에 연결하고, 가입 완료 후 서버가 owner_id를 지정한다. 연결 전 초안을 지원하려면 profiles에 invitation_id 참조를 두고 owner_id는 가입 전 NULL을 허용한다. 초대한 사람이라고 타인의 기존 프로필 소유권을 임의로 지정할 수 없다.

## 권한과 상태 전이
- 초대 발급: 로그인 회원만. 만료/발급량 제한을 서버에서 검사.
- 공개: 본인이 승인한 버전만 공개. 승인 이후 주선자 수정은 별도 초안으로 두거나 비공개 전환 후 재승인.
- 매칭: 요청자는 취소, 수신자는 수락/거절. 상태 변경은 pending일 때만 원자적으로 처리.
- 클라이언트가 보낸 사용자 ID를 인증 근거로 쓰지 않는다. 인증 세션에서 요청자를 확정한다.

## 관계 거리
members.invited_by를 양방향 간선으로 해석한다. 서버에서 BFS로 최단 연결 수를 계산한다. 자신은 0촌, 직접 초대 연결은 1촌, 경로가 없으면 null이다. 공개 응답은 숫자만 반환하며 중간 회원 정보를 보내지 않는다. 거리 계산의 그래프에는 비공개 프로필 회원도 포함하지만 그 신원은 노출하지 않는다. 탈퇴 시 관계 보존 여부와 동의 정책은 실제 운영 전에 확정한다.

## API 계약(구현 예정)
| 메서드·경로 | 기능 |
|---|---|
| POST /api/invitations | 1회용 코드 발급 |
| POST /api/join | 인증된 신규 계정과 초대 코드 결합 |
| GET /api/profiles | 공개 프로필과 요청자 기준 촌수 반환 |
| POST /api/profile | 프로필 초안 저장 |
| POST /api/profile-approval | 본인의 프로필 공개/숨김 |
| POST /api/matches | 매칭 요청 |
| GET /api/matches | 본인에게 관련된 요청만 반환 |
| POST /api/match-response | 수락/거절/취소 |
| POST /api/introduction | { notes } → { introduction } |

공통 오류는 { error: { code, message } } 형태. 400 입력 오류, 401 미인증, 403 권한 없음, 409 중복/상태 충돌, 429 호출 제한, 502 외부 API 실패, 504 시간 초과. 개인정보 포함 응답은 캐시를 제한한다. 인증 방식 확정 후 CSRF 방어와 쿠키 속성을 설정한다.
