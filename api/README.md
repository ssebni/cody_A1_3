# Python API

`index.py`의 FastAPI 앱이 모든 `/api/*` 경로와 공개 HTML/CSS/JS를 제공합니다.
로컬: `python -m uvicorn api.index:app --reload`.
Vercel: 루트 `pyproject.toml`의 `tool.vercel.entrypoint = "api.index:app"` 사용.

과거 `save_intro.py`의 작성자 ID 신뢰 방식은 제거했습니다. 모든 회원 API는
Bearer 토큰을 Supabase Auth에서 검증하고 활성 회원 여부를 확인합니다.
서비스 역할 키로 DB에 접근하므로 서버와 SQL 양쪽에서 권한을 확인합니다.
초대 가입은 `/api/verify_invite` 경로를 유지합니다.

API 계약은 [데이터 설계](../docs/data-design.md), 설정은 [실행·배포 안내](../README.md)를 참고하세요.
