# ALLIN V5.3.2

## 수정 사항
- 회원 로그인 함수에서 `extensions.crypt()`를 명시적으로 사용
- 회원 이름 앞뒤 공백을 무시하도록 개선
- 회원 로그인 실패 시 오래된 세션 삭제
- PWA 캐시 버전을 V5.3.2로 갱신
- 예전 로그인 화면이 남지 않도록 정적 파일 버전 갱신

## 적용 순서
1. Supabase SQL Editor에서 `ALLIN_V532_Member_Login_Repair.sql` 실행
2. GitHub 운영 저장소 파일을 V5.3.2 파일로 교체
3. 브라우저에서 Ctrl+Shift+R
4. 설치형 PWA는 완전히 종료 후 다시 실행
