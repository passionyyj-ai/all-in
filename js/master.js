
function renderMaster(){
  ensureV6State();
  const id=String(byId('masterId')?.value||'').toLowerCase().trim();
  const cat=byId('masterCat')?.value||'';
  const kw=String(byId('masterSearch')?.value||'').toLowerCase().trim();
  const rows=state.products
    .filter(p=>!id || String(p.id||'').toLowerCase().includes(id))
    .filter(p=>!cat || (p.category||'미분류')===cat)
    .filter(p=>!kw || String(p.name||'').toLowerCase().includes(kw))
    .map(p=>`<tr>
      <td>${p.id}</td>
      <td>${p.category||''}</td>
      <td>${p.name||''}</td>
      <td>${money(p.purchasePrice)}</td>
      <td>${money(defaultSalePrice(p))}</td>
      <td>${qty(currentQty(p))}</td>
      <td><a class="btn small-btn" href="hospital_price.html?productId=${encodeURIComponent(p.id)}">관리</a></td>
      <td><button class="btn small-btn" onclick="editProductMaster('${p.id}')">수정</button></td>
    </tr>`);
  byId('masterTable').innerHTML=rows.join('')||'<tr><td colspan="8" class="empty">품목이 없습니다.</td></tr>';
}
function editProductMaster(id){
  const p=productById(id); if(!p) return;
  byId('pmId').value=p.id;
  byId('pmCat').value=p.category||'';
  byId('pmName').value=p.name||'';
  byId('pmPurchase').value=p.purchasePrice||0;
  byId('pmDefaultSale').value=defaultSalePrice(p);
  window.scrollTo({top:0,behavior:'smooth'});
}
function clearProductMasterForm(){
  ['pmId','pmCat','pmName'].forEach(id=>byId(id).value='');
  ['pmPurchase','pmDefaultSale'].forEach(id=>byId(id).value=0);
}
function migrateProductReferences(oldId,newId){
  if(!oldId||oldId===newId)return;
  state.transactions.forEach(t=>{if(t.productId===oldId)t.productId=newId;});
  state.overuses.forEach(o=>{if(o.productId===oldId)o.productId=newId;});
  state.hospitalPrices.forEach(x=>{if(x.productId===oldId)x.productId=newId;});
  ['system','physical','result'].forEach(k=>(state.audit?.[k]||[]).forEach(x=>{
    if(x.productId===oldId)x.productId=newId;
    if(x.id===oldId)x.id=newId;
  }));
}
function saveProductMaster(){
  ensureV6State();
  const id=byId('pmId').value.trim() || `P${String(state.products.length+1).padStart(3,'0')}`;
  const name=byId('pmName').value.trim();
  if(!name) return alert('품목명을 입력하세요.');
  let p=productById(id) || state.products.find(x=>x.name===name);
  const oldId=p?.id||id;
  if(!p){
    p={id, name, category:'', purchasePrice:0, defaultSalePrice:0, stock:{}};
    state.products.push(p);
  }
  p.id=id;
  p.name=name;
  p.category=byId('pmCat').value.trim()||'미분류';
  p.purchasePrice=parseNumber(byId('pmPurchase').value);
  p.defaultSalePrice=parseNumber(byId('pmDefaultSale').value);
  migrateProductReferences(oldId,id);
  addHistory('품목저장',name,1);
  categoryOptions(byId('masterCat'),true);
  renderMaster();
  clearProductMasterForm();
}
function handleMasterUpload(e){
  const file=e.target.files[0]; if(!file) return;
  readWorkbook(file, rows=>{
    let ok=0;
    rows.forEach(r=>{
      const id=r['ID']||r['품목ID']||`P${String(state.products.length+1).padStart(3,'0')}`;
      const name=r['품목명']; if(!name) return;
      let p=productById(id)||state.products.find(x=>x.name===name);
      const oldId=p?.id||id;
      if(!p){p={id,name,category:'미분류',purchasePrice:0,defaultSalePrice:0,stock:{}};state.products.push(p);}
      p.id=id;
      p.name=name;
      p.category=r['제품카테고리']||r['카테고리']||'미분류';
      p.purchasePrice=parseNumber(r['매입단가']);
      p.defaultSalePrice=parseNumber(r['기본판매단가']||r['판매단가']||r['판매단가(기타)']);
      migrateProductReferences(oldId,id);
      ok++;
    });
    addHistory('품목업로드',file.name,ok);
    byId('masterUploadResult').innerHTML=`<span class="pill ok">${ok}건 반영</span>`;
    categoryOptions(byId('masterCat'),true);
    renderMaster();
  });
}
function downloadMasterUploadSample(){
  const rows=[['ID','제품카테고리','품목명','매입단가','기본판매단가'],['P999','Guidewire','Sample Guidewire',10000,15000]];
  download('ProductMaster_upload.csv',toCSV(rows),'text/csv;charset=utf-8');
}
function exportMasterCSV(){
  const rows=[['ID','제품카테고리','품목명','매입단가','기본판매단가','전체현재고']];
  state.products.forEach(p=>rows.push([p.id,p.category,p.name,p.purchasePrice,defaultSalePrice(p),currentQty(p)]));
  download('product_master.csv',toCSV(rows),'text/csv;charset=utf-8');
}
document.addEventListener('DOMContentLoaded',()=>{ensureV6State();categoryOptions(byId('masterCat'),true);renderMaster();});
