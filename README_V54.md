# ALLIN V5.4

## 반영 사항

### 1. 회원용/총무용 홈 화면 바로가기 분리
- 회원용 Manifest: `manifest-member.webmanifest`
- 총무용 Manifest: `manifest-admin.webmanifest`
- 회원용 시작 주소: `/all-in/?app=member`
- 총무용 시작 주소: `/all-in/admin.html?app=admin`
- 총무용 ADMIN 아이콘 별도 제공
- iPhone 홈 화면 앱 이름을 `ALLIN 회원`, `ALLIN 총무`로 구분

### 2. 2~4팀 경기 결과 등록
- 경기 추가 시 실제 편성된 팀 중 두 팀 선택
- A vs C, B vs D 등 모든 조합 등록 가능
- 동일 팀끼리 경기 생성 방지
- 생성된 경기별 점수와 승패 입력 가능
- 기존 결과 취소 및 삭제 기능 유지

## 적용
- Supabase SQL 실행은 필요하지 않습니다.
- GitHub 운영 저장소의 파일을 전부 교체하세요.
- iPhone에서는 기존 ALLIN 홈 화면 아이콘을 삭제한 뒤 각각 다시 설치해야 합니다.

### iPhone 설치 순서
1. Safari에서 회원 주소 `/all-in/` 접속 → 공유 → 홈 화면에 추가
2. Safari에서 총무 주소 `/all-in/admin.html` 접속 → 공유 → 홈 화면에 추가
