# ALLIN V5.2.1

## 신규 기능
- 회원별 주 포지션 1개 지정
- 보조 포지션 복수 선택
- 주 포지션은 보조 포지션에서 자동 제외
- 회원 목록에서 주/보조 포지션을 구분해 표시
- 포지션 필터가 주 포지션과 보조 포지션을 모두 검색

## 적용 순서
1. Supabase SQL Editor에서 `ALLIN_V52_DB_Update.sql` 실행
2. GitHub Pages 파일을 본 패키지로 교체
3. 앱을 완전히 종료한 뒤 다시 실행

---

# ALLIN V5.0.3 - iOS Manifest Icon Fix

## 원인 수정
- apple-touch-icon 선언 제거
- Web App Manifest 아이콘을 홈 화면 아이콘 소스로 통일
- 기존 아이콘 캐시를 피하기 위해 아이콘 파일명 자체를 신규 생성
  - allin-app-icon-192-v503.png
  - allin-app-icon-512-v503.png
- Manifest 파일명도 신규 생성
  - allin-manifest-v503.webmanifest
- V5.0.2의 잘못된 `v=5.0.2.2` 버전 문자열 수정
- Service Worker 캐시 `allin-v5.0.3`

## 적용
1. GitHub all-in 저장소에 ZIP 전체 덮어 업로드
2. GitHub Pages 배포 완료 대기
3. 기존 홈 화면 ALLIN/올 아이콘 삭제
4. iPhone 설정 > Safari > 고급 > 웹 사이트 데이터에서 passionyyj-ai.github.io 데이터 삭제 권장
5. Safari를 완전히 종료 후 다시 실행
6. https://passionyyj-ai.github.io/all-in/admin.html 직접 접속
7. 공유 > 홈 화면에 추가 > 웹 앱으로 열기 ON > 추가

추가 Supabase SQL은 필요 없습니다.

## V5.1 업데이트
- 자동 팀 편성 시 참석자 전원을 강제 배분하여 대기인원 제거
- 기존 4명 기준 팀 수를 유지하면서 남는 인원을 균등 분산 (예: 13명 → 5/4/4)
- 관리자 화면에서 회원별 팀을 직접 변경 가능
- 진행 중인 시리즈에서는 팀 재편성 및 수동 변경 잠금
- 적용 전 Supabase SQL Editor에서 `ALLIN_V51_DB_Update.sql` 실행 필요


## V5.2.1 Hotfix
- 미수 메뉴의 게임 횟수를 회원별 게임비 청구 건수 합계가 아닌 실제 경기/시리즈 ID의 중복 제거 개수로 표시합니다.
- 표시 단위를 `건`에서 `경기`로 변경했습니다.
- 데이터베이스 변경은 필요하지 않습니다.
