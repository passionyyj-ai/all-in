# ALLIN V5.6.5 참석 저장 오류 수정

## 원인
`set_my_attendance()` 함수가 PIN 검증 시 `crypt()`를 public 검색 경로에서
호출했지만, 현재 Supabase의 pgcrypto 함수는 `extensions` 스키마에 있어
참석/불참 저장이 실패했습니다.

## 수정
- `extensions.crypt()` 명시
- 함수 search_path에 `extensions` 추가
- 참석/불참 중복 클릭 방지
- 오류 발생 시 실제 Supabase 오류 메시지 표시
- 회원 로그아웃과 기존 기능 유지

## 적용
1. Supabase SQL Editor에서 `ALLIN_V565_Attendance_Fix.sql` 전체 실행
2. GitHub 운영 저장소 파일 교체
3. 아이폰 앱 완전 종료 후 다시 실행
