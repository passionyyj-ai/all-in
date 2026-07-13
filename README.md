# ⚽ 올인 족구단 V3.3

## V3.3 변경
- 일자별 수입/지출 내역에 `수정` 버튼 추가
- 수동 등록 내역의 일자, 구분, 항목, 회원/대상, 금액, 비고 수정 가능
- 회비 납부 및 게임비 입금확인으로 자동 생성된 내역은 직접 수정 금지
- 자동 생성 내역은 `회비 자동`, `게임비 자동` 배지로 표시
- 자동 생성 내역 삭제도 원본 메뉴에서만 취소 가능

# ⚽ 올인 족구단 V3.2

## 이번 버전
- 실제 Supabase Project URL / Publishable key 연결 완료
- 첨부된 ALLIN JOKGUCLUB 2023 이미지 적용
- 회원 로그인/참석 화면 경기장 배경 디자인
- 총무 로그인과 관리자 헤더에 ALLIN 로고 적용
- ALLIN 핑크/블랙 브랜드 테마 적용

## 접속 주소
회원: https://passionyyj-ai.github.io/all-in/
총무: https://passionyyj-ai.github.io/all-in/admin.html

## 로그인
회원: admin / 1111
총무: admin / 1111

## 중요: Supabase DB 최초 설정
`supabase_setup.sql`을 Supabase SQL Editor에서 전체 실행해야 합니다.

총무 로그인용으로 Supabase Dashboard > Authentication > Users에서:
- Email: admin@allin.club
- Password: 1111
- Auto Confirm User: ON

계정을 만든 뒤 SQL 맨 아래 관리자 등록 구문을 실행합니다.

# V3.1 로그인 정보

- 회원 화면: `admin` / `1111`
- 총무 화면: `admin` / `1111`

## 총무 계정 1회 설정
Supabase Dashboard → Authentication → Users → Add user:
- Email: `admin@allin.club`
- Password: `1111`
- Auto Confirm User: ON

그 다음 `supabase_setup.sql` 맨 아래 관리자 등록 SQL을 실행하세요.

> 주의: GitHub Pages 공개 저장소에서 회원 로그인은 단순 접근 잠금입니다. 총무 권한은 Supabase Auth와 RLS가 별도로 확인합니다.

# ⚽ 올인 족구단 v3

GitHub Pages + Supabase 기반 모바일 웹앱입니다.

## V3 핵심 변경

- 총무용 관리 화면 / 회원용 참석 체크 화면 분리
- 회원은 이름 + 4자리 PIN으로 참석/불참 직접 체크
- 일요일 경기 운영 모드 추가
- 경기 점수 입력 시 승패 자동 판정
- 개인별 경기 데이터 기반 승률 계산 구조 추가
- 패배 팀원 1인당 2,000원 게임비는 **수입으로 자동 반영하지 않음**
- 경기 결과 저장 시 `game_dues`에 **미납 청구(미수금)** 만 생성
- 총무가 실제 입금을 확인하고 `입금확인`을 누른 시점에만 수입 내역 생성
- 입금취소 시 연결된 수입 내역도 자동 삭제

## 화면

- `index.html` : 회원용 참석 체크
- `admin.html` : 총무용 관리 및 일요일 경기 운영

## 게임비 회계 흐름

1. 경기 점수 입력
2. 승리팀/패배팀 자동 판정
3. 패배 팀원별 2,000원 `미납 청구` 생성
4. 이 단계에서는 `transactions` 수입에 반영되지 않음
5. 실제 계좌 입금 또는 현금 수납 확인
6. 총무가 `미수` 메뉴에서 `입금확인`
7. 그 시점에만 게임비 수입 내역 생성

## Supabase 설치

1. 새 Supabase 프로젝트 생성
2. SQL Editor에서 `supabase_setup.sql` 전체 실행
3. Authentication > Users에서 총무 계정 생성
4. SQL 파일 맨 아래 관리자 등록 SQL의 이메일을 실제 총무 이메일로 변경 후 실행
5. Project URL과 Publishable key 확인
6. `config.js`에 입력

```js
window.ALLIN_CONFIG = {
  SUPABASE_URL: "https://프로젝트ID.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_..."
};
```

Secret key 또는 service_role key를 브라우저 코드에 넣지 마세요.

## GitHub Pages 배포

ZIP 압축을 푼 뒤 모든 파일을 GitHub 저장소 루트에 업로드합니다.

GitHub:

1. Settings
2. Pages
3. Build and deployment
4. Source: Deploy from a branch
5. Branch: main
6. Folder: / (root)
7. Save

회원:
`https://사용자명.github.io/저장소명/`

총무:
`https://사용자명.github.io/저장소명/admin.html`

## 아이폰

Safari에서 회원 주소 접속 → 공유 → 홈 화면에 추가
