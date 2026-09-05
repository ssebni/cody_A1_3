# 내친소
초대 관계를 바탕으로 지인의 프로필을 탐색하고 매칭을 요청하는 서비스.

## 현재 상태
기획·데이터 설계와 가상 데이터 기반 반응형 화면 시제품. Supabase 이메일 로그인·로그아웃 코드를 연결했습니다(실제 계정 성공 검증은 대기 중). DB 테이블은 사용자 실행 완료. 회원 데이터 연결, 초대 가입, 매칭 전송, AI API, Vercel 배포는 아직 구현하지 않았습니다. 과제 제출 완료 상태가 아닙니다.

## 실행
Python 3가 설치된 환경에서 프로젝트 루트에서 실행합니다.

```sh
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 접속. 이 서버는 정적 화면 확인용이며 Python API를 실행하지 않습니다.

## 구조와 기술
- index.html: 홈·프로필 탐색·소개글 입력·역할별 마이페이지
- css/style.css: 반응형 스타일
- js/app.js: 가상 데이터 관계 거리 계산, 필터, 상세 창, 요청 체험
- api/: Vercel Python 함수 구현 예정
- docs/service-plan.md: 서비스 기획 및 검증 기준
- docs/data-design.md: 데이터 모델·권한·API 계약

프론트는 순수 HTML/CSS/JavaScript. 백엔드는 Vercel Python Serverless Functions와 영구 DB, 인증 서비스를 연결할 예정입니다.

## 환경 변수와 배포
현재 시제품에는 키가 필요하지 않습니다. AI 및 인증/DB 제공자 확정 후 서버 환경 변수 목록과 requirements.txt를 추가합니다. 실제 키는 코드·문서·스크린샷에 넣지 않고 로컬 비밀 파일과 Vercel 환경 변수에서 관리합니다.

배포 URL: 미배포. GitHub 연동, Vercel 환경 변수 등록, 실제 가입 및 AI 호출 검증을 완료한 뒤 기재합니다.

## 남은 제출물
실제 AI 연동, GitHub 저장소 업로드·커밋 이력, Vercel 배포 URL, 데스크톱·모바일·실제 AI 동작 스크린샷, AI 코딩 도구 사용 증빙.

## 로그인 연결
js/config.js에는 공개용 Project URL과 Publishable key만 있습니다. js/auth.js는 Supabase JS v2를 CDN에서 불러옵니다. 인터넷 연결이 필요합니다. 로그인 세션은 메모리에서만 유지하며 새로고침 후 재로그인이 필요합니다. 실제 인증 성공과 내친소 회원 활성화는 별개이며, 현재 대시보드는 가상 데이터입니다.

최초 운영자 테스트 계정은 Supabase Authentication의 Users에서 직접 생성해 로그인 연결을 확인합니다. 초대 없이 만드는 이 계정은 최초 운영자에 한정하며, 일반 회원은 후속 Python 초대 가입 API를 사용합니다. 계정 생성만으로 public.members 행이 자동 생성되지는 않습니다.
