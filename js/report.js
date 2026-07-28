function inventoryValueSummary(){
  const locations=getLocations();
  const byLocation=Object.fromEntries(locations.map(location=>[location,0]));
  let unpricedItems=0;

  state.products.forEach(product=>{
    const price=purchasePrice(product);
    let hasCurrentStock=false;

    locations.forEach(location=>{
      const current=Number(currentQty(product,location)||0);
      if(current!==0) hasCurrentStock=true;
      byLocation[location]=(byLocation[location]||0)+(current*price);
    });

    if(hasCurrentStock&&price<=0) unpricedItems+=1;
  });

  const total=Object.values(byLocation).reduce((sum,value)=>sum+value,0);
  const office=byLocation['사무실']||0;
  const hospital=locations
    .filter(location=>location!=='사무실')
    .reduce((sum,location)=>sum+(byLocation[location]||0),0);

  return {byLocation,total,office,hospital,unpricedItems};
}

function renderReport(){
  ensureV6State();
  const s=inventorySummary();
  const values=inventoryValueSummary();
  byId('reportGeneratedAt').textContent=`생성일시: ${new Date().toLocaleString('ko-KR')} · 재고금액은 현재고 × 매입단가 기준`;
  byId('rKpiStock').textContent=qty(s.totalStock);
  byId('rKpiCurrent').textContent=qty(s.totalCurrent);
  byId('rKpiUse').textContent=qty(s.totalUse);
  byId('rKpiOveruse').textContent=qty(s.totalOver);
  byId('rKpiOffice').textContent=qty(s.loc['사무실']?.current||0);
  byId('rKpiHospital').textContent=qty(getLocations().filter(l=>l!=='사무실').reduce((a,l)=>a+(s.loc[l]?.current||0),0));
  byId('rKpiPrepaid').textContent=qty(Object.values(s.loc).reduce((a,l)=>a+(l.prepaid||0),0));
  byId('rKpiRecovery').textContent=qty(Object.values(s.loc).reduce((a,l)=>a+(l.recovery||0),0));
  byId('rKpiInventoryValue').textContent=`${money(values.total)}원`;
  byId('rKpiOfficeValue').textContent=`${money(values.office)}원`;
  byId('rKpiHospitalValue').textContent=`${money(values.hospital)}원`;
  byId('rKpiUnpricedItems').textContent=qty(values.unpricedItems);
  byId('reportLocationSummary').innerHTML=getLocations().map(l=>{
    const x=s.loc[l]||{stock:0,current:0,in:0,use:0,prepaid:0,recovery:0};
    return `<tr><td>${l}</td><td>${qty(x.stock)}</td><td>${qty(x.current)}</td><td>${money(values.byLocation[l]||0)}원</td><td>${qty(x.in)}</td><td>${qty(x.use)}</td><td>${qty(x.prepaid)}</td><td>${qty(x.recovery||0)}</td></tr>`;
  }).join('');
  byId('reportRecentTx').innerHTML=state.transactions.slice(0,15).map(t=>`<tr><td>${t.date||''}</td><td>${t.location||''}</td><td>${t.type||''}</td><td>${productById(t.productId)?.name||''}</td><td>${qty(t.qty)}</td><td>${t.memo||''}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">거래 내역이 없습니다.</td></tr>';
}

function exportReportCSV(){
  const s=inventorySummary();
  const values=inventoryValueSummary();
  const rows=[
    ['구분','값'],
    ['전체 기준재고',s.totalStock],
    ['전체 현재고',s.totalCurrent],
    ['총 재고금액',values.total],
    ['사무실 재고금액',values.office],
    ['병원 재고금액',values.hospital],
    ['매입단가 미등록 재고 품목',values.unpricedItems],
    ['누적 사용',s.totalUse],
    ['미정리 과사용',s.totalOver],
    ['사무실 현재고',s.loc['사무실']?.current||0],
    ['병원 현재고',getLocations().filter(l=>l!=='사무실').reduce((a,l)=>a+(s.loc[l]?.current||0),0)],
    ['누적 선납',Object.values(s.loc).reduce((a,l)=>a+(l.prepaid||0),0)],
    ['누적 회수',Object.values(s.loc).reduce((a,l)=>a+(l.recovery||0),0)],
    [],
    ['위치','기준재고','현재고','재고금액','입고','사용','선납','회수']
  ];
  getLocations().forEach(l=>{
    const x=s.loc[l]||{};
    rows.push([l,x.stock||0,x.current||0,values.byLocation[l]||0,x.in||0,x.use||0,x.prepaid||0,x.recovery||0]);
  });
  download('dashboard_report.csv',toCSV(rows),'text/csv;charset=utf-8');
}

document.addEventListener('DOMContentLoaded',renderReport);
