# v12 변경 내용

- 이메일 기반 Supabase 로그인 화면을 대경 Tracking 아이디 로그인으로 변경
- 환경설정에 관리자 전용 사용자 관리 추가
- 사용자 등록, 이름·권한·상태 수정, 비밀번호 초기화 지원
- 관리자, 재고담당, 영업담당, 조회전용 메뉴 구분
- 비밀번호와 관리자 API를 Supabase Edge Function에서만 처리
- 기존 `app_state`, Cloud 동기화, LocalStorage 캐시 및 업무 기능 유지
- 기존 GitHub의 실제 `js/config.js`를 보호하기 위해 배포 ZIP에서 해당 파일 제외

