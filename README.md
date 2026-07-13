# ALLIN V4.6 - 회비 납부 안정화

## 수정 내용
- fee_payments 조회 오류가 전체 관리자 화면을 중단시키던 문제 완화
- 회비 저장/취소 오류 메시지를 화면에 구체적으로 표시
- fee_payments / fees / transactions 권한 재정비
- admin_save_fee_payment RPC 재생성
- PostgREST 스키마 캐시 갱신
- 1개월 일시납, 3개월, 6개월, 12개월 연납 유지
- 다개월 납부는 실제 수입 1건만 생성
- 선택 기간 월별 회비 납부 상태 자동 연결
- 중복 월 납부 연결 방지

## 적용 순서
1. GitHub all-in 저장소에 V4.6 ZIP 내용을 덮어 업로드
2. Supabase SQL Editor에서 ALLIN_V46_Fee_Fix.txt 전체 실행
3. 관리자 페이지 로그아웃 후 다시 로그인
4. 회비 메뉴에서 월 회비 금액 확인
5. 회원 납부 버튼 → 1개월 일시납 테스트
