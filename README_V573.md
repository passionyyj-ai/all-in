# ALLIN V5.7.3 총무 비밀번호 키보드 강제 수정

## 수정 내용
- 총무 로그인 비밀번호에서 inputmode 제거
- pattern, maxlength, minlength 제거
- type=tel / type=number 가능성 제거
- 비밀번호 변경 화면의 현재/신규/확인 입력칸도 동일 처리
- 페이지 로딩 시 JavaScript가 숫자 전용 속성을 다시 제거
- Service Worker, HTML, JS, Manifest 버전 전체 갱신
- 기존 캐시 1회 자동 정리

## 유지
- 회원 PIN은 숫자 키패드 유지
- 시스템 초기화 PIN은 숫자 키패드 유지
- 회원/총무 PWA 분리 유지

## 적용
SQL 업데이트는 필요하지 않습니다.
GitHub 운영 저장소 파일을 교체한 뒤:
1. 아이폰에서 기존 ALLIN 총무 앱을 삭제
2. Safari에서 admin.html을 직접 연다
3. 공유 → 홈 화면에 추가
4. 새 아이콘으로 다시 실행
