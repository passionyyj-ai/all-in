
let auditData = (state && state.audit) ? state.audit : { system: [], physical: [], result: [], source: '' };
function saveAuditState(reason='audit'){ state.audit = auditData; saveState(reason); }
function auditToday(){ return new Date().toISOString().slice(0,10); }
function setAuditDate(){ const el=byId('auditDate'); if(el && !el.value) el.value=auditToday(); }
function blankOption(){ return '<option value="">선택 안 함</option>'; }
function fillCols(prefix, headers){
  ['Id','Name','Loc','Qty','Amt','Memo'].forEach(s=>{ const el=byId(prefix+s+'Col'); if(el) el.innerHTML=blankOption()+headers.map(h=>`<option value="${h}">${h}</option>`).join(''); });
  const pick=(cands)=> headers.find(h=>cands.some(c=>String(h).toLowerCase().replace(/\s/g,'').includes(c))) || '';
  const set=(id,val)=>{ const el=byId(id); if(el) el.value=val; };
  set(prefix+'IdCol', pick(['id','품목코드','제품코드','code']));
  set(prefix+'NameCol', pick(['품목명','제품명','name']));
  set(prefix+'LocCol', pick(['위치','병원','location']));
  set(prefix+'QtyCol', pick(prefix==='physical'?['실사수량','수량','qty']:['현재고','재고수량','수량','qty']));
  set(prefix+'AmtCol', pick(['재고금액','금액','amount','amt']));
  set(prefix+'MemoCol', pick(['비고','memo','remark']));
}
function readWorkbookFile(file, cb){
  const reader=new FileReader();
  reader.onload=e=>{
    const data=e.target.result;
    let rows=[];
    if(file.name.toLowerCase().endsWith('.csv')){
      const text=new TextDecoder('utf-8').decode(new Uint8Array(data));
      rows=text.split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(x=>x.replace(/^"|"$/g,'')));
    } else {
      const wb=XLSX.read(data,{type:'array'}); const ws=wb.Sheets[wb.SheetNames[0]];
      rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
    }
    const headers=(rows[0]||[]).map(String); const list=rows.slice(1).filter(r=>r.some(v=>String(v).trim()!=='')).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]??''])));
    cb(headers,list);
  };
  reader.readAsArrayBuffer(file);
}
function handleAuditFile(evt,type){
  const file=evt.target.files[0]; if(!file) return;
  readWorkbookFile(file,(headers,list)=>{
    auditData[type]=list; auditData.source = type==='system' ? '외부 시스템 재고 파일' : auditData.source;
    fillCols(type, headers);
    byId(type+'Info').innerHTML=`${file.name} / ${list.length.toLocaleString('ko-KR')}건을 불러왔습니다.`;
    saveAuditState(type==='system'?'audit-system-upload':'audit-physical-upload');
  });
}
function initAuditLocationSelect(){
  const el=byId('auditLoadLoc');
  if(!el) return;
  el.innerHTML='<option value="">전체 위치별</option>'+getLocations().map(l=>`<option value="${l}">${l}</option>`).join('');
}
function renderSystemLocationSummary(rows){
  const el=byId('systemLocationSummary');
  if(!el) return;
  if(!rows.length){ el.innerHTML=''; return; }
  const summary={};
  rows.forEach(r=>{
    const loc=r.위치||'전체';
    if(!summary[loc]) summary[loc]={items:0,qty:0,amt:0};
    summary[loc].items+=1;
    summary[loc].qty+=Number(r.시스템수량||0);
    summary[loc].amt+=Number(r.재고금액||0);
  });
  el.innerHTML=`<div class="table-wrap"><table class="system-location-summary-table"><colgroup><col class="location-col"><col class="item-col"><col class="quantity-col"><col class="amount-col"></colgroup><thead><tr><th>위치</th><th>품목수</th><th>현재고 합계</th><th>재고금액</th></tr></thead><tbody>${Object.entries(summary).map(([loc,v])=>`<tr><td>${loc}</td><td class="num">${qty(v.items)}</td><td class="num">${qty(v.qty)}</td><td class="num">${money(v.amt)}</td></tr>`).join('')}</tbody></table></div>`;
}
function loadSystemFromV7ByLocation(mode){
  const selectedLoc=byId('auditLoadLoc')?.value||'';
  const rows=[];
  if(mode==='aggregate'){
    state.products.forEach(p=>{
      const total=getLocations().reduce((sum,loc)=>sum+currentQty(p,loc),0);
      rows.push({ID:p.id, 품목명:p.name, 위치:'전체', 시스템수량:total, 재고금액:(Number(p.purchasePrice||0)*total)});
    });
    auditData.source='v7 현재고 전체 합산';
  } else {
    const locs=selectedLoc?[selectedLoc]:getLocations();
    state.products.forEach(p=>locs.forEach(loc=>{
      const current=currentQty(p,loc);
      rows.push({ID:p.id, 품목명:p.name, 위치:loc, 시스템수량:current, 재고금액:(Number(p.purchasePrice||0)*current)});
    }));
    auditData.source=selectedLoc?`v7 현재고 - ${selectedLoc}`:'v7 현재고 - 전체 위치별';
  }
  auditData.system=rows;
  const headers=['ID','품목명','위치','시스템수량','재고금액']; fillCols('system',headers);
  byId('systemIdCol').value='ID'; byId('systemNameCol').value='품목명'; byId('systemLocCol').value='위치'; byId('systemQtyCol').value='시스템수량'; byId('systemAmtCol').value='재고금액';
  const locText=mode==='aggregate'?'전체 합산':(selectedLoc?selectedLoc:'전체 위치별');
  byId('systemInfo').innerHTML=`${auditData.source} 기준으로 ${rows.length.toLocaleString('ko-KR')}건을 불러왔습니다. <b>불러오기 방식: ${locText}</b>`;
  renderSystemLocationSummary(rows);
  saveAuditState('audit-system-load');
}

function loadSystemFromV7(){ loadSystemFromV7ByLocation(); }
function recKey(id,name,loc){ return `${String(id||'').trim()||'NAME:'+String(name||'').trim()}||${String(loc||'전체').trim()||'전체'}`; }
function convertRows(type){
  const prefix=type; const idCol=byId(prefix+'IdCol')?.value, nameCol=byId(prefix+'NameCol')?.value, locCol=byId(prefix+'LocCol')?.value, qtyCol=byId(prefix+'QtyCol')?.value, amtCol=byId(prefix+'AmtCol')?.value, memoCol=byId(prefix+'MemoCol')?.value;
  if(!idCol && !nameCol) throw new Error((type==='system'?'시스템':'실사')+' 재고의 ID 또는 품목명 컬럼을 선택하세요.');
  if(!qtyCol) throw new Error((type==='system'?'시스템':'실사')+' 재고의 수량 컬럼을 선택하세요.');
  const map=new Map();
  auditData[type].forEach(r=>{
    const id=String(r[idCol]??'').trim(); const name=String(r[nameCol]??'').trim(); const loc=String(r[locCol]??'전체').trim()||'전체';
    if(!id && !name) return;
    const key=recKey(id,name,loc); const old=map.get(key)||{id,name,loc,qty:0,amt:0,memo:''};
    old.id=old.id||id; old.name=old.name||name; old.loc=loc; old.qty+=parseNumber(r[qtyCol]); old.amt+=amtCol?parseNumber(r[amtCol]):0; if(memoCol && r[memoCol]) old.memo=String(r[memoCol]);
    map.set(key,old);
  });
  return map;
}
function riskRank(r){ return {OK:0,Low:1,Medium:2,High:3}[r]??0; }
function classify(s,p,qtyMed,amtMed,amtHigh){
  const sys=s?.qty??0, phy=p?.qty??0, sysAmt=s?.amt??0, phyAmt=p?.amt??0;
  const qdiff=phy-sys, adiff=phyAmt-sysAmt;
  let type='일치', risk='OK';
  if(s && !p){ type='실사 누락'; risk='High'; }
  else if(!s && p){ type='시스템 미등록'; risk='High'; }
  else {
    const qtyMismatch=qdiff!==0, amtMismatch=adiff!==0;
    if(qtyMismatch && amtMismatch) type='수량/금액 불일치';
    else if(qtyMismatch) type='수량 불일치';
    else if(amtMismatch) type='금액 불일치';
    if(qtyMismatch){ risk = Math.abs(qdiff)>=qtyMed ? 'Medium' : 'Low'; }
    if(amtMismatch){ const ar=Math.abs(adiff)>=amtHigh?'High':(Math.abs(adiff)>=amtMed?'Medium':'Low'); if(riskRank(ar)>riskRank(risk)) risk=ar; }
  }
  const cause = type==='일치'?'차이 없음': type==='실사 누락'?'실사 누락 또는 현장 미확인 가능성 확인 필요': type==='시스템 미등록'?'시스템 미등록 또는 품목 ID 매칭 오류 확인 필요':'입출고 미반영, 실사 오류, ID/위치 매칭 오류 여부 확인 필요';
  return {sys,phy,sysAmt,phyAmt,qdiff,adiff,type,risk,cause};
}
function runAudit(){
  try{
    if(!auditData.system.length) loadSystemFromV7ByLocation();
    if(!auditData.physical.length) throw new Error('실사 재고 파일을 먼저 업로드하세요.');
    const sm=convertRows('system'), pm=convertRows('physical');
    const keys=new Set([...sm.keys(),...pm.keys()]); const qtyMed=parseNumber(byId('qtyMedium').value)||2, amtMed=parseNumber(byId('amtMedium').value), amtHigh=parseNumber(byId('amtHigh').value);
    auditData.result=[...keys].map(k=>{ const s=sm.get(k), p=pm.get(k), c=classify(s,p,qtyMed,amtMed,amtHigh); const master=(s?.id||p?.id)?productById(s?.id||p?.id):null; return {id:s?.id||p?.id||'', name:s?.name||p?.name||master?.name||'', loc:s?.loc||p?.loc||'전체', memo:p?.memo||'', ...c}; }).sort((a,b)=>riskRank(b.risk)-riskRank(a.risk)||String(a.id).localeCompare(String(b.id)));
    renderAudit(); saveAuditState('audit-run'); addHistory('재고 감사','재고 감사 분석 실행',auditData.result.length);
  }catch(e){ alert(e.message); }
}
function renderAudit(){
  byId('auditResult').classList.remove('hidden');
  const rows=auditData.result, diffs=rows.filter(r=>r.type!=='일치'), high=rows.filter(r=>r.risk==='High');
  byId('sourceBadge').textContent=auditData.source||'외부 파일'; byId('auditTotal').textContent=rows.length.toLocaleString('ko-KR'); byId('auditDiff').textContent=diffs.length.toLocaleString('ko-KR'); byId('auditHigh').textContent=high.length.toLocaleString('ko-KR');
  byId('auditSummaryText').innerHTML=`감사일자 ${byId('auditDate').value||auditToday()} 기준, 총 <b>${rows.length.toLocaleString('ko-KR')}</b>개 품목/위치를 비교했습니다. 차이 발생 항목은 <b>${diffs.length.toLocaleString('ko-KR')}</b>건이며, 이 중 High 리스크는 <b>${high.length.toLocaleString('ko-KR')}</b>건입니다. 원인은 자동 단정하지 않고 상세표에 확인 필요 항목으로 표시했습니다.`;
  byId('auditRecommendations').innerHTML=['High 리스크 항목은 현장 실사표, 입출고 거래, 선납/회수 내역을 우선 대조하세요.','ID가 없는 항목은 품목 Master와 실사 양식의 품목 ID 체계를 먼저 정비하세요.','수량 차이가 반복되는 병원/위치는 거래 입력 시점과 실사 기준일을 맞춰 관리하세요.','금액 차이가 큰 품목은 매입단가/판매단가 기준과 재고 평가단가를 별도 확인하세요.'].map(x=>`<li>${x}</li>`).join('');
  byId('auditChecklist').innerHTML=[['High 차이 원인 확인','실사 누락/시스템 미등록','High'],['수량 불일치 재검표','Medium 이상 수량 차이','Medium'],['단가 기준 검토','금액 차이 발생 품목','Medium'],['품목 ID 보완','ID 누락 또는 품목명 매칭 항목','High'],['조정 거래 등록','확정 차이 품목','Medium']].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
  renderAuditTable();
}
function riskPill(r){ const cls=r==='High'?'risk-high':r==='Medium'?'risk-medium':r==='Low'?'risk-low':'risk-ok'; return `<span class="pill ${cls}">${r}</span>`; }
function renderAuditTable(){
  const q=(byId('auditSearch')?.value||'').toLowerCase(), rf=byId('auditRiskFilter')?.value||'', tf=byId('auditTypeFilter')?.value||'';
  let rows=auditData.result.filter(r=>(!rf||r.risk===rf)&&(!tf||r.type===tf||r.type.includes(tf))&&(!q||[r.id,r.name,r.loc].join(' ').toLowerCase().includes(q)));
  byId('auditTable').innerHTML=rows.map(r=>`<tr><td>${riskPill(r.risk)}</td><td>${r.type}</td><td>${r.id}</td><td>${r.name}</td><td>${r.loc}</td><td class="num">${qty(r.sys)}</td><td class="num">${qty(r.phy)}</td><td class="num ${r.qdiff<0?'diff-minus':r.qdiff>0?'diff-plus':''}">${qty(r.qdiff)}</td><td class="num">${money(r.sysAmt)}</td><td class="num">${money(r.phyAmt)}</td><td class="num ${r.adiff<0?'diff-minus':r.adiff>0?'diff-plus':''}">${money(r.adiff)}</td><td>${r.cause}</td><td>${r.memo||''}</td></tr>`).join('') || '<tr><td colspan="13">표시할 항목이 없습니다.</td></tr>';
}
function auditRowsForExport(){ return [['리스크','유형','ID','품목명','위치','시스템수량','실사수량','수량차이','시스템금액','실사금액','금액차이','원인추정','비고'],...auditData.result.map(r=>[r.risk,r.type,r.id,r.name,r.loc,r.sys,r.phy,r.qdiff,r.sysAmt,r.phyAmt,r.adiff,r.cause,r.memo])]; }
function downloadAuditCSV(){ if(!auditData.result.length) return alert('분석 결과가 없습니다.'); download(`재고감사결과_${auditToday()}.csv`, toCSV(auditRowsForExport()), 'text/csv;charset=utf-8'); }
function downloadAuditExcel(){ if(!auditData.result.length) return alert('분석 결과가 없습니다.'); const ws=XLSX.utils.aoa_to_sheet(auditRowsForExport()); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'재고감사결과'); XLSX.writeFile(wb,`재고감사결과_${auditToday()}.xlsx`); }
function downloadAuditSample(){ const rows=[['ID','품목명','위치','실사수량','실사금액','비고'],['P000','TRANSEND 014/205','사무실',9,0,'샘플'],['P003','Synchro .014"','경북대',8,0,'실사 수량 확인']]; const ws=XLSX.utils.aoa_to_sheet(rows); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'PhysicalInventory'); XLSX.writeFile(wb,'Audit_PhysicalInventory_upload.xlsx'); }
document.addEventListener('DOMContentLoaded',()=>{ setAuditDate(); initAuditLocationSelect(); const rf=byId('restoreFile'); if(rf) rf.onchange=restoreBackup; if(auditData.system?.length){ fillCols('system', Object.keys(auditData.system[0]||{})); renderSystemLocationSummary(auditData.system); byId('systemInfo').innerHTML=`저장된 시스템 재고 ${auditData.system.length.toLocaleString('ko-KR')}건을 복원했습니다.`; } if(auditData.physical?.length){ fillCols('physical', Object.keys(auditData.physical[0]||{})); byId('physicalInfo').innerHTML=`저장된 실사 재고 ${auditData.physical.length.toLocaleString('ko-KR')}건을 복원했습니다.`; } if(auditData.result?.length){ renderAudit(); } });
