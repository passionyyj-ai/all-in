let visiblePriceRows = [];
function selectedHospitals(){
  ensureV6State();
  const h = byId('priceHospital')?.value || '';
  return h ? state.hospitals.filter(x=>x.name===h) : state.hospitals;
}
function buildPriceRows(){
  ensureV6State();
  const cat=byId('priceCat')?.value || '';
  const kw=String(byId('priceSearch')?.value||'').toLowerCase().trim();
  const hospitals=selectedHospitals();
  const products=state.products.filter(p=>(!cat || (p.category||'미분류')===cat) && (!kw || String(p.name||'').toLowerCase().includes(kw) || String(p.category||'').toLowerCase().includes(kw)));
  const rows=[];
  hospitals.forEach(h=>products.forEach(p=>rows.push({hospitalName:h.name, productId:p.id})));
  const sort=byId('priceSort')?.value || 'name';
  rows.sort((a,b)=>{
    const pa=productById(a.productId), pb=productById(b.productId);
    const saleA=getHospitalPrice(a.productId,a.hospitalName), saleB=getHospitalPrice(b.productId,b.hospitalName);
    const purA=purchasePrice(pa), purB=purchasePrice(pb);
    const marginA=saleA-purA, marginB=saleB-purB;
    if(sort==='saleDesc') return saleB-saleA;
    if(sort==='marginDesc') return marginB-marginA;
    if(sort==='purchaseDesc') return purB-purA;
    const n=String(pa?.name||'').localeCompare(String(pb?.name||''),'ko');
    return n || String(a.hospitalName).localeCompare(String(b.hospitalName),'ko');
  });
  return rows;
}
function renderPrice(){
  ensureV6State();
  visiblePriceRows=buildPriceRows();
  const saleAvg=visiblePriceRows.reduce((a,r)=>a+getHospitalPrice(r.productId,r.hospitalName),0)/(visiblePriceRows.length||1);
  const purAvg=visiblePriceRows.reduce((a,r)=>a+purchasePrice(productById(r.productId)),0)/(visiblePriceRows.length||1);
  const marginRate=saleAvg?((saleAvg-purAvg)/saleAvg*100):0;
  byId('priceCount').textContent=qty(visiblePriceRows.length);
  byId('avgSalePrice').textContent=money(Math.round(saleAvg));
  byId('avgPurchasePrice').textContent=money(Math.round(purAvg));
  byId('avgMarginRate').textContent=marginRate.toFixed(1)+'%';
  byId('priceTable').innerHTML=visiblePriceRows.map((r,idx)=>{
    const p=productById(r.productId);
    const sale=getHospitalPrice(r.productId,r.hospitalName);
    const pur=purchasePrice(p);
    const margin=sale-pur;
    const rate=sale?(margin/sale*100):0;
    const rowKey=`${r.hospitalName}__${r.productId}`;
    return `<tr>
      <td>${r.hospitalName}</td><td>${p.id}</td><td>${p.category||''}</td><td>${p.name||''}</td>
      <td><input type="number" min="0" value="${sale}" data-key="${rowKey}" data-hospital="${r.hospitalName}" data-product="${p.id}" class="price-sale-input" oninput="recalcPriceRow(this)"></td>
      <td><input type="number" min="0" value="${pur}" data-key="${rowKey}" data-product="${p.id}" class="price-purchase-input" oninput="recalcPriceRow(this)"></td>
      <td class="price-margin" data-key="${rowKey}">${money(margin)}</td><td class="price-rate" data-key="${rowKey}">${rate.toFixed(1)}%</td>
      <td><button class="btn small-btn" onclick="savePriceRow('${r.hospitalName}','${p.id}')">수정</button></td>
    </tr>`;
  }).join('')||'<tr><td colspan="9" class="empty">단가 데이터가 없습니다.</td></tr>';
}
function recalcPriceRow(input){
  const key=input.dataset.key;
  const sale=Number(document.querySelector(`.price-sale-input[data-key="${CSS.escape(key)}"]`)?.value||0);
  const pur=Number(document.querySelector(`.price-purchase-input[data-key="${CSS.escape(key)}"]`)?.value||0);
  const margin=sale-pur;
  const rate=sale?(margin/sale*100):0;
  const m=document.querySelector(`.price-margin[data-key="${CSS.escape(key)}"]`);
  const r=document.querySelector(`.price-rate[data-key="${CSS.escape(key)}"]`);
  if(m)m.textContent=money(margin);
  if(r)r.textContent=rate.toFixed(1)+'%';
}
function savePriceRow(hospitalName, productId){
  const key=`${hospitalName}__${productId}`;
  const p=productById(productId);
  const sale=Number(document.querySelector(`.price-sale-input[data-key="${CSS.escape(key)}"]`)?.value||0);
  const pur=Number(document.querySelector(`.price-purchase-input[data-key="${CSS.escape(key)}"]`)?.value||0);
  setHospitalPrice(productId,hospitalName,sale);
  if(p) p.purchasePrice=pur;
  addHistory('단가수정',`${hospitalName} / ${p?.name||productId}`,1);
  saveState();
  byId('priceResult').innerHTML=`<span class="pill ok">1건 저장</span>`;
  renderPrice();
}
function saveAllVisiblePrices(){
  ensureV6State();
  let ok=0;
  document.querySelectorAll('.price-sale-input').forEach(inp=>{
    const productId=inp.dataset.product;
    const hospitalName=inp.dataset.hospital;
    const p=productById(productId);
    const pur=Number(document.querySelector(`.price-purchase-input[data-key="${CSS.escape(inp.dataset.key)}"]`)?.value||0);
    setHospitalPrice(productId,hospitalName,Number(inp.value||0));
    if(p) p.purchasePrice=pur;
    ok++;
  });
  addHistory('단가일괄저장','조회 목록 단가 저장',ok);
  saveState();
  byId('priceResult').innerHTML=`<span class="pill ok">${ok}건 저장</span>`;
  renderPrice();
}
function handlePriceUpload(e){
  const file=e.target.files[0]; if(!file) return;
  readWorkbook(file, rows=>{
    ensureV6State();
    let ok=0, skip=0;
    rows.forEach(r=>{
      const hospitalName=r['병원명']||r['병원']||r['위치'];
      const productId=r['ID']||r['품목ID'];
      const productName=r['품목명']||r['품명'];
      const p=productId?productById(productId):state.products.find(x=>x.name===productName);
      if(!hospitalName || !p){skip++; return;}
      const sale=parseNumber(r['판매단가']||r['병원판매단가']||r['판매 단가']);
      const purRaw=r['매입단가']||r['매입 단가'];
      setHospitalPrice(p.id,hospitalName,sale);
      if(purRaw!=='' && purRaw!==undefined) p.purchasePrice=parseNumber(purRaw);
      ok++;
    });
    addHistory('단가일괄등록',file.name,ok);
    saveState();
    byId('priceResult').innerHTML=`<span class="pill ok">${ok}건 반영</span>`+(skip?` <span class="pill warn">${skip}건 제외</span>`:'');
    renderPrice();
  });
}
function downloadPriceUploadSample(){
  ensureV6State();
  const p=state.products[0]||{id:'P001',name:'Sample',category:'카테고리',purchasePrice:0};
  const rows=[['병원명','ID','제품카테고리','품목명','판매단가','매입단가'],['경북대',p.id,p.category,p.name,getHospitalPrice(p.id,'경북대')||15000,purchasePrice(p)||10000],['영대',p.id,p.category,p.name,getHospitalPrice(p.id,'영대')||15000,purchasePrice(p)||10000]];
  if(window.XLSX){
    const wb=XLSX.utils.book_new();
    const ws=XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb,ws,'단가일괄등록');
    XLSX.writeFile(wb,'단가일괄등록_샘플.xlsx');
  }else{
    download('단가일괄등록_샘플.csv',toCSV(rows),'text/csv;charset=utf-8');
  }
}
function exportPriceCSV(){
  ensureV6State();
  const rows=[['병원명','ID','제품카테고리','품명','판매단가','매입단가','예상마진','마진율']];
  buildPriceRows().forEach(r=>{
    const p=productById(r.productId), sale=getHospitalPrice(r.productId,r.hospitalName), pur=purchasePrice(p), margin=sale-pur;
    rows.push([r.hospitalName,p.id,p.category,p.name,sale,pur,margin,sale?(margin/sale*100).toFixed(1)+'%':'0%']);
  });
  download('price.csv',toCSV(rows),'text/csv;charset=utf-8');
}
document.addEventListener('DOMContentLoaded',()=>{ensureV6State();hospitalOptions(byId('priceHospital'),true);categoryOptions(byId('priceCat'),true);renderPrice();});
