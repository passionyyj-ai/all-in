# v12.13 로그인 오류 수정

현재 GitHub Pages 파일만 교체해서는 로그인 문제가 해결되지 않습니다. Supabase에 배포된 `auth-login` 코드가 GitHub 소스와 달라서, 정상적인 JSON 요청도 빈 값으로 처리하고 있었습니다.

## 반드시 적용할 두 단계

1. GitHub 저장소 파일을 이 수정본으로 교체합니다.
2. Supabase Dashboard의 `Edge Functions → auth-login → Code`에서
   `supabase/functions/auth-login/index.ts` 전체 내용을 붙여 넣고 다시 배포합니다.

`auth-login`은 로그인 전 호출되므로 JWT 검증을 끈 상태여야 합니다. CLI에서는 다음과 같습니다.

```bash
supabase functions deploy auth-login --no-verify-jwt
```

배포 후 GitHub Pages 로그인 화면에서 `Ctrl + F5`로 강력 새로고침한 뒤 대경 아이디와 비밀번호로 로그인합니다.

## 수정 내용

- 로그인 요청의 `username`/`password`를 안정적으로 판독
- 과거 버전의 아이디 필드명도 호환
- CORS 및 POST 요청 처리 명확화
- 로그인 함수 오류를 구분 가능한 메시지로 반환
- 브라우저 요청에 publishable key 인증 헤더 보강
- 로그인 관련 JavaScript 캐시 버전 갱신
