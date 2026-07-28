function dashboardInventoryValueSummary(){
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

function renderDashboard(){
  const locations=getLocations();
  const s=inventorySummary();
  const values=dashboardInventoryValueSummary();
  byId('kpiStock').textContent=qty(s.totalStock);
  byId('kpiCurrent').textContent=qty(s.totalCurrent);
  byId('kpiUse').textContent=qty(s.totalUse);
  byId('kpiOveruse').textContent=qty(s.totalOver);
  byId('kpiOffice').textContent=qty(s.loc['사무실']?.current||0);
  byId('kpiHospital').textContent=qty(locations.filter(l=>l!=='사무실').reduce((a,l)=>a+(s.loc[l]?.current||0),0));
  byId('kpiPrepaid').textContent=qty(Object.values(s.loc).reduce((a,l)=>a+(l.prepaid||0),0));
  byId('kpiRecovery').textContent=qty(Object.values(s.loc).reduce((a,l)=>a+(l.recovery||0),0));
  const inventoryValueKpi=byId('kpiInventoryValue');
  const officeValueKpi=byId('kpiOfficeValue');
  const hospitalValueKpi=byId('kpiHospitalValue');
  const unpricedItemsKpi=byId('kpiUnpricedItems');
  if(inventoryValueKpi) inventoryValueKpi.textContent=`${money(values.total)}원`;
  if(officeValueKpi) officeValueKpi.textContent=`${money(values.office)}원`;
  if(hospitalValueKpi) hospitalValueKpi.textContent=`${money(values.hospital)}원`;
  if(unpricedItemsKpi) unpricedItemsKpi.textContent=qty(values.unpricedItems);
  byId('locationSummary').innerHTML=locations.map(l=>{
    const x=s.loc[l]||{stock:0,current:0,in:0,use:0,prepaid:0,recovery:0};
    return `<tr><td>${l}</td><td>${qty(x.stock)}</td><td>${qty(x.current)}</td><td>${money(values.byLocation[l]||0)}원</td><td>${qty(x.in)}</td><td>${qty(x.use)}</td><td>${qty(x.prepaid)}</td><td>${qty(x.recovery||0)}</td></tr>`;
  }).join('');
  byId('recentTx').innerHTML=state.transactions.slice(0,15).map(t=>`<tr><td>${t.date||''}</td><td>${t.location||''}</td><td>${t.type||''}</td><td>${productById(t.productId)?.name||''}</td><td>${qty(t.qty)}</td><td>${t.memo||''}</td></tr>`).join('')||'<tr><td colspan="6" class="empty">거래 내역이 없습니다.</td></tr>';
}

document.addEventListener('DOMContentLoaded',renderDashboard);
