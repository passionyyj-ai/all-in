# 대경 Tracking Cloud v11 설치 가이드

## 1. Supabase 프로젝트 생성
1. Supabase에서 새 프로젝트를 생성합니다.
2. SQL Editor에서 `supabase_schema.sql` 전체를 실행합니다.
3. Authentication > Users에서 사용할 이메일 사용자를 생성합니다.
4. Project Settings > API에서 Project URL과 publishable key(또는 legacy anon key)를 확인합니다.

## 2. v11 설정
`js/config.js`를 열고 아래 두 값을 변경합니다.

```js
supabaseUrl: 'https://실제프로젝트.supabase.co',
supabaseKey: '실제 publishable 또는 anon key',
```

`service_role` 또는 secret key는 절대로 입력하지 마세요.

## 3. GitHub Pages 배포
1. GitHub 저장소를 생성합니다.
2. `Daekyung Tracking System` 폴더 안의 파일 전체를 저장소 루트에 업로드합니다.
3. Settings > Pages > Build and deployment에서 `Deploy from a branch`를 선택합니다.
4. Branch를 `main`, 폴더를 `/(root)`로 선택하고 Save 합니다.
5. 발급된 GitHub Pages 주소에서 `login.html` 또는 `index.html`을 엽니다.

## 4. 데이터 동작
- LocalStorage: 오프라인 캐시 및 즉시 자동저장
- Supabase `app_state`: 회사 공용 공식 데이터
- 로그인 후 원격 데이터가 더 최신이면 자동으로 내려받습니다.
- 로컬 데이터가 더 최신이면 Supabase로 자동 동기화합니다.
- 인터넷이 끊기면 LocalStorage에 계속 저장하고 온라인 복귀 시 동기화를 재시도합니다.

## 5. v10 데이터 이전
v10에서 JSON 백업을 내려받은 뒤 v11에서 JSON 복원을 실행하면 로컬에 반영되고 Supabase로 자동 업로드됩니다.

## 중요
v11은 기존 기능 안정성을 위해 전체 AppState를 JSONB 1건으로 동기화하는 1차 Cloud 버전입니다. 여러 사용자가 같은 순간에 수정하면 마지막 저장 데이터가 우선할 수 있습니다. 다음 단계에서는 `product_master`, `hospital_master`, `inventory_transaction`, `inventory_balance`, `hospital_sale_price`, `inventory_audit` 등 테이블별 저장으로 전환하는 것을 권장합니다.
