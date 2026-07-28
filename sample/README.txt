대경 Tracking System 샘플 파일 안내

- ProductMaster_upload.xlsx: 품목 Master 일괄 등록 샘플
- Inventory_upload.xlsx: 재고 수량 업로드 샘플
- Transaction_upload.xlsx: 거래 업로드 샘플
- HospitalMaster_upload.xlsx: 병원 Master 일괄 등록 샘플
- HospitalPrice_upload.xlsx: 병원별 판매단가 일괄 등록 샘플
- PriceBulk_upload.xlsx: 단가관리 메뉴용 병원별 판매단가/매입단가 일괄 등록 샘플

v6 수정 반영 사항
- LOT/유효기간 메뉴는 제거되었습니다.
- 단가관리는 병원별 판매단가 입력/수정 및 조회 목록 일괄 저장을 지원합니다.
- 예상마진과 마진율은 병원별 판매단가 기준으로 계산됩니다.
- 단가관리 화면에서 사용수량/사용매출 컬럼은 제거되었습니다.
- 보고서는 거래이력/변경이력 중심이 아니라 Dashboard 요약 내용을 보고서 형태로 출력합니다.

[v7 변경]
- 거래관리 최근 거래 컬럼을 ID/품목명/판매단가/매출금액/재고반영/비고 기준으로 정렬했습니다.
- 거래 업로드 양식에 ID 컬럼을 추가했습니다. ID가 있으면 ID 기준, 없으면 품목명 기준으로 매칭합니다.


[v8 추가]
- Audit_PhysicalInventory_upload.xlsx: 재고 감사 메뉴의 실사 재고 업로드 샘플입니다.
- 재고 감사 메뉴는 v7 현재고를 시스템 재고 기준으로 불러온 뒤, 실사 재고와 ID/위치 기준으로 비교할 수 있습니다.
