# ALLIN V5.7.6 참석 직접 수정 3상태

## 총무 참석 직접 수정
각 회원을 아래 세 가지 상태로 지정할 수 있습니다.

- 참석
- 불참
- 미응답

## 저장 기준
- 참석 회원은 attendance.attending=true
- 불참 회원은 attendance.attending=false
- 미응답 회원은 attendance 기록 없음
- 팀 편성에는 참석 회원만 포함

## 적용 화면
- 총무용 참석 메뉴
- 회원 대리 경기운영의 참석 메뉴

## 적용
1. Supabase SQL Editor에서 `ALLIN_V576_Attendance_Three_State.sql` 실행
2. GitHub 운영 저장소 파일 교체
3. 모바일 앱 완전 종료 후 다시 실행
