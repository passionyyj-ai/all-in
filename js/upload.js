function txSalePrice(t){ return getHospitalPrice(t.productId, t.location); }
function txAmount(t){ return Number(t.qty||0) * txSalePrice(t); }
function txImpactText(t){const q=qty(t.qty);if(t.type==='선납')return `사무실 -${q} / ${t.location} +${q}`;if(t.type==='회수')return `사무실 +${q} / ${t.location} -${q}`;if(t.type==='사용')return `${t.location} -${q}`;if(t.type==='입고')return `${t.location} +${q}`;if(t.type==='조정(+)')return `${t.location} +${q}`;if(t.type==='조정(-)'||t.type==='과사용')return `${t.location} -${q}`;return '';}

function addManualTx(){
  const tx = {
    date: byId('mDate').value || today(),
    location: byId('mLoc').value,
    type: byId('mType').value,
    productId: byId('mProd').value,
    qty: parseNumber(byId('mQty').value),
    memo: byId('mMemo').value
  };
  if(!tx.productId || !tx.qty) return alert('품목과 수량을 확인하세요.');
  if(tx.type === '선납' && tx.location === '사무실') return alert('선납은 병원에 재고가 입고되는 거래입니다. 위치를 병원으로 선택하세요.');
  if(tx.type === '회수' && tx.location === '사무실') return alert('회수는 병원 재고를 사무실로 회수하는 거래입니다. 위치를 병원으로 선택하세요.');
  state.transactions.unshift(tx);
  addHistory('거래등록', `${tx.location} ${tx.type}`, 1);
  renderTx();
}
function addOveruse(){ const o={status:'미정리',date:byId('oDate').value||today(),location:byId('oLoc').value,productId:byId('oProd').value,qty:parseNumber(byId('oQty').value),memo:byId('oMemo').value}; state.overuses.unshift(o); state.transactions.unshift({...o,type:'과사용'}); addHistory('과사용',o.memo||'과사용 임시 반영',1); renderTx(); }
function closeOveruse(i){ state.overuses[i].status='정리완료'; addHistory('과사용정리',state.overuses[i].memo||'',1); renderTx(); }
function renderTx(){
  byId('txTable').innerHTML=state.transactions.slice(0,300).map(t=>{
    const p=productById(t.productId);
    const sale=txSalePrice(t);
    const amount=txAmount(t);
    return `<tr><td>${t.date}</td><td>${t.location}</td><td>${t.type}</td><td>${p?.id||t.productId||''}</td><td>${p?.name||''}</td><td>${qty(t.qty)}</td><td>${money(sale)}</td><td>${money(amount)}</td><td>${txImpactText(t)}</td><td>${t.memo||''}</td></tr>`;
  }).join('')||'<tr><td colspan="10" class="empty">거래 내역이 없습니다.</td></tr>';
  byId('overuseTable').innerHTML=state.overuses.map((o,i)=>{ const p=productById(o.productId); return `<tr><td>${o.status}</td><td>${o.date}</td><td>${o.location}</td><td>${p?.id||o.productId||''}</td><td>${p?.name||''}</td><td>${qty(o.qty)}</td><td>${o.memo||''}</td><td>${o.status==='정리완료'?'':`<button class="btn small-btn" onclick="closeOveruse(${i})">정리완료</button>`}</td></tr>`; }).join('')||'<tr><td colspan="8" class="empty">과사용 내역이 없습니다.</td></tr>';
}
function handleTxUpload(e){
  const file = e.target.files[0];
  if(!file) return;
  readWorkbook(file, rows => {
    let ok = 0, skip = 0;
    rows.forEach(r => {
      const productId = String(r['ID'] || r['품목ID'] || '').trim();
      const name = r['품목명'];
      const p = productId ? state.products.find(x => String(x.id) === productId) : state.products.find(x => x.name === name);
      const type = r['구분'] || '사용';
      const location = r['병원'] || r['위치'] || '사무실';
      const qtyValue = parseNumber(r['수량']);
      if(!p || !qtyValue) { skip++; return; }
      if(['선납','회수'].includes(type) && location === '사무실') { skip++; return; }

      state.transactions.unshift({
        date: normalizeDate(r['날짜']),
        location,
        type,
        productId: p.id,
        qty: qtyValue,
        memo: r['비고'] || ''
      });
      ok++;
    });
    addHistory('거래업로드', file.name, ok);
    byId('txUploadResult').innerHTML = `<span class="pill ok">${ok}건 반영</span>` + (skip ? ` <span class="pill warn">${skip}건 제외</span>` : '');
    renderTx();
  });
}
document.addEventListener('DOMContentLoaded',()=>{ byId('mDate').value=today(); byId('oDate').value=today(); locationOptions(byId('mLoc')); locationOptions(byId('oLoc')); productOptions(byId('mProd')); productOptions(byId('oProd')); renderTx(); });


// 품목명 검색 팝업: 카테고리 필터 + 품목명 LIKE(부분 일치) 검색
let activeProductSelectId = 'mProd';

function openProductSearchPopup(targetSelectId='mProd'){
  activeProductSelectId = targetSelectId;
  const modal = byId('productSearchModal');
  if(!modal) return;
  categoryOptions(byId('psCat'), true);
  const selectedId = byId(targetSelectId)?.value;
  const selectedProduct = productById(selectedId);
  if(selectedProduct && byId('psCat')) byId('psCat').value = selectedProduct.category || '';
  if(byId('psKeyword')) byId('psKeyword').value = '';
  modal.classList.remove('hidden');
  renderProductSearchResults();
  setTimeout(()=>byId('psKeyword')?.focus(), 0);
}

function closeProductSearchPopup(){
  byId('productSearchModal')?.classList.add('hidden');
}

function normalizeSearchText(value){
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function renderProductSearchResults(){
  const tbody = byId('psResults');
  if(!tbody) return;
  const category = byId('psCat')?.value || '';
  const keyword = normalizeSearchText(byId('psKeyword')?.value || '');
  const rows = state.products
    .filter(p => !category || (p.category || '미분류') === category)
    .filter(p => !keyword || normalizeSearchText(p.name).includes(keyword) || normalizeSearchText(p.category).includes(keyword))
    .sort((a,b) => String(a.category||'').localeCompare(String(b.category||''), 'ko') || String(a.name||'').localeCompare(String(b.name||''), 'ko'))
    .slice(0, 300);

  tbody.innerHTML = rows.map(p => `
    <tr class="click-row" ondblclick="selectProductFromPopup('${p.id}')">
      <td><button type="button" class="btn small-btn primary" onclick="selectProductFromPopup('${p.id}')">선택</button></td>
      <td>${p.id}</td>
      <td>${p.category || '미분류'}</td>
      <td>${p.name}</td>
      <td>${qty(currentQty(p))}</td>
    </tr>`).join('') || '<tr><td colspan="5" class="empty">검색 결과가 없습니다.</td></tr>';
}

function selectProductFromPopup(productId){
  const select = byId(activeProductSelectId);
  if(select) select.value = productId;
  closeProductSearchPopup();
}

document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && !byId('productSearchModal')?.classList.contains('hidden')) closeProductSearchPopup();
});

function downloadTxSample(){
  const p=state.products[0]||{};
  const rows=[['날짜','병원','구분','ID','품목명','수량','비고'],[today(),'경북대','선납',p.id||'',p.name||'',1,'사무실 → 병원'],[today(),'경북대','사용',p.id||'',p.name||'',1,'병원 사용'],[today(),'경북대','회수',p.id||'',p.name||'',1,'병원 → 사무실']];
  if(window.XLSX){
    const ws=XLSX.utils.aoa_to_sheet(rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '거래업로드');
    XLSX.writeFile(wb, 'Transaction_upload.xlsx');
  } else {
    download('Transaction_upload.csv',toCSV(rows),'text/csv;charset=utf-8');
  }
}
