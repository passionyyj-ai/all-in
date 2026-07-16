# ALLIN V5.5.2

## 변경 사항
- 회원용 회비입금현황을 로그인한 본인 기록만 표시
- 본인 PIN을 검증하는 `get_my_member_dashboard` RPC 추가
- 회원용 화면에 `총무 운영 화면` 버튼 추가
- 대리 운영 화면은 기존 관리자 로그인과 관리자 권한 확인 후 사용
- 회원 로그아웃, PWA 분리, 3팀 단판 시리즈 유지

## 적용 순서
1. Supabase SQL Editor에서 `ALLIN_V552_Private_Member_Fee.sql` 실행
2. GitHub 운영 저장소를 V5.5.2 파일로 교체
3. PC는 Ctrl+Shift+R, iPhone 앱은 완전히 종료 후 다시 실행
