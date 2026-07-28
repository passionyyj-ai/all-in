
let visibleHospitalPriceRows = [];
function getQueryParam(name){
  return new URLSearchParams(location.search).get(name);
}
function renderHospitalPrice(){
  ensureV6State();
  const hospital = byId('hpHospital').value;
  const category = byId('hpCategory').value;
  const keyword = String(byId('hpKeyword').value||'').toLowerCase().trim();
  const selectedProductId = getQueryParam('productId');

  const hospitals = hospital ? state.hospitals.filter(h=>h.name===hospital) : state.hospitals;
  const products = state.products
    .filter(p=>!selectedProductId || p.id===selectedProductId)
    .filter(p=>!category || (p.category||'미분류')===category)
    .filter(p=>!keyword || String(p.name||'').toLowerCase().includes(keyword));

  visibleHospitalPriceRows = [];
  hospitals.forEach(h=>{
    products.forEach(p=>{
      visibleHospitalPriceRows.push({hospitalName:h.name, productId:p.id});
    });
  });

  byId('hospitalPriceTable').innerHTML = visibleHospitalPriceRows.map((r, idx)=>{
    const p = productById(r.productId);
    const price = getHospitalPrice(r.productId, r.hospitalName);
    const pur = purchasePrice(p);
    const margin = price - pur;
    const rate = price ? (margin / price * 100) : 0;
    return `<tr>
      <td>${r.hospitalName}</td>
      <td>${p.id}</td>
      <td>${p.category||''}</td>
      <td>${p.name||''}</td>
      <td>${money(defaultSalePrice(p))}</td>
      <td><input type="number" min="0" value="${price}" data-hospital="${r.hospitalName}" data-product="${p.id}" class="hp-price-input"></td>
      <td>${money(pur)}</td>
      <td>${money(margin)}</td>
      <td>${rate.toFixed(1)}%</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9" class="empty">조회 결과가 없습니다.</td></tr>';
}
function saveVisibleHospitalPrices(){
  ensureV6State();
  let ok=0;
  document.querySelectorAll('.hp-price-input').forEach(input=>{
    setHospitalPrice(input.dataset.product, input.dataset.hospital, parseNumber(input.value));
    ok++;
  });
  addHistory('병원별단가저장','화면 단가 저장',ok);
  byId('hpResult').innerHTML=`<span class="pill ok">${ok}건 저장</span>`;
  renderHospitalPrice();
}
function handleHospitalPriceUpload(e){
  const file=e.target.files[0]; if(!file) return;
  readWorkbook(file, rows=>{
    let ok=0, skip=0;
    rows.forEach(r=>{
      const hospitalName = r['병원명'] || r['병원'];
      const productId = r['ID'] || r['품목ID'];
      const productName = r['품목명'];
      const p = productId ? productById(productId) : state.products.find(x=>x.name===productName);
      if(!hospitalName || !p){skip++; return;}
      setHospitalPrice(p.id, hospitalName, parseNumber(r['판매단가']||r['병원판매단가']));
      ok++;
    });
    addHistory('병원별단가업로드',file.name,ok);
    byId('hpResult').innerHTML=`<span class="pill ok">${ok}건 반영</span>`+(skip?` <span class="pill warn">${skip}건 제외</span>`:'');
    renderHospitalPrice();
  });
}
function downloadHospitalPriceSample(){
  const p=state.products[0];
  const h=state.hospitals[0];
  const rows=[['병원명','ID','품목명','판매단가'],[h?.name||'경북대',p?.id||'P001',p?.name||'Sample Guidewire',15000]];
  download('HospitalPrice_upload.csv',toCSV(rows),'text/csv;charset=utf-8');
}
function exportHospitalPriceCSV(){
  ensureV6State();
  const rows=[['병원명','ID','제품카테고리','품목명','기본판매단가','병원판매단가','매입단가']];
  state.hospitals.forEach(h=>{
    state.products.forEach(p=>{
      rows.push([h.name,p.id,p.category,p.name,defaultSalePrice(p),getHospitalPrice(p.id,h.name),purchasePrice(p)]);
    });
  });
  download('hospital_price.csv',toCSV(rows),'text/csv;charset=utf-8');
}
document.addEventListener('DOMContentLoaded',()=>{
  ensureV6State();
  hospitalOptions(byId('hpHospital'),true);
  categoryOptions(byId('hpCategory'),true);
  const productId = getQueryParam('productId');
  if(productId){
    const p = productById(productId);
    if(p && byId('hpKeyword')) byId('hpKeyword').value = p.name;
  }
  renderHospitalPrice();
});
