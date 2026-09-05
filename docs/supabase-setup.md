# Supabase 초기 설정

1. 내친소 프로젝트의 SQL Editor에서 새 쿼리를 엽니다.
2. supabase/migrations/001_initial_schema.sql 전체를 붙여넣고 Run을 누릅니다.
3. 결과에 invitations, matches, members, profiles 네 행이 나오고 rls_enabled가 모두 true인지 확인합니다.

이 파일은 새 프로젝트용이며 한 번 실행합니다. 재실행 시 이미 테이블이 있다는 오류가 발생할 수 있습니다. 테이블 삭제로 해결하지 말고 실행 상태를 확인하세요. 기존 데이터를 삭제하는 SQL은 포함하지 않습니다.

현재 단계는 테이블 준비만 수행합니다. 원격 실행 및 실제 DB 동작 검증은 아직 하지 않았습니다. 일반 브라우저 계정의 테이블 직접 접근을 차단해 두었습니다. Python API는 서버 전용 권한을 사용하므로 인증된 회원인지와 데이터 접근 권한을 반드시 별도로 검사해야 합니다.

후속 구현: 공개 가입 비활성화 및 서버 가입 경로, 이메일 확인, 초대 코드 예약/소진과 실패 복구, 초대자 불변 규칙, 프로필 승인 권한, 갱신 시각 처리, 매칭 상태 전이, 연락처 별도 저장소. 인증 사용자 삭제와 회원 탈퇴 정책도 구현 전에 확정합니다. 아직 가입 서비스를 사용할 수는 없습니다.

공식 문서:
- https://supabase.com/docs/guides/database/tables
- https://supabase.com/docs/guides/database/postgres/row-level-security
