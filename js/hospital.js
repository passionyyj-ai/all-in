function renderHospital(){
  ensureV6State();
  ensureHospitalState();
  sortHospitalMaster();
  byId('hospitalTable').innerHTML=state.hospitals.map((h,i)=>`<tr>
    <td>${h.code||''}</td><td>${h.name||''}</td><td>${h.manager||''}</td>
    <td>${h.phone||''}</td><td>${h.address||''}</td><td>${h.memo||''}</td>
    <td><button class="btn small-btn" onclick="editHospital(${i})">수정</button></td>
  </tr>`).join('')||'<tr><td colspan="7" class="empty">병원 정보가 없습니다.</td></tr>';
}

function editHospital(i){
  const h=state.hospitals[i]; if(!h)return;
  byId('hCode').value=h.code||'';
  byId('hName').value=h.name||'';
  byId('hManager').value=h.manager||'';
  byId('hPhone').value=h.phone||'';
  byId('hAddress').value=h.address||'';
  byId('hMemo').value=h.memo||'';
  byId('hCode').dataset.originalCode=h.code||'';
  byId('hName').dataset.originalName=h.name||'';
}

function migrateHospitalReferences(oldName,newName){
  if(!oldName||oldName===newName)return;
  state.transactions.forEach(t=>{if(t.location===oldName)t.location=newName;});
  state.overuses.forEach(o=>{if(o.location===oldName)o.location=newName;});
  state.hospitalPrices.forEach(x=>{if(x.hospitalName===oldName)x.hospitalName=newName;});
  state.products.forEach(p=>{
    if(p.stock?.[oldName]){
      p.stock[newName]=Object.assign({},p.stock[oldName],p.stock[newName]||{});
      delete p.stock[oldName];
    }
    if(p.salePrices && Object.prototype.hasOwnProperty.call(p.salePrices,oldName)){
      p.salePrices[newName]=p.salePrices[oldName];
      delete p.salePrices[oldName];
    }
  });
  ['system','physical','result'].forEach(k=>(state.audit?.[k]||[]).forEach(x=>{
    if(x.location===oldName)x.location=newName;
  }));
}

function saveHospital(){
  ensureHospitalState();
  const code=byId('hCode').value.trim()||`H${String(state.hospitals.length+1).padStart(3,'0')}`;
  const name=byId('hName').value.trim();
  if(!name)return alert('병원명을 입력하세요.');
  const originalCode=byId('hCode').dataset.originalCode||code;
  let h=state.hospitals.find(x=>x.code===originalCode)||state.hospitals.find(x=>x.code===code)||state.hospitals.find(x=>x.name===name);
  const oldName=h?.name||byId('hName').dataset.originalName||name;
  if(!h){h={code,name};state.hospitals.push(h);}
  migrateHospitalReferences(oldName,name);
  h.code=code;
  h.name=name;
  h.manager=byId('hManager').value;
  h.phone=byId('hPhone').value;
  h.address=byId('hAddress').value;
  h.memo=byId('hMemo').value;
  sortHospitalMaster();
  addHistory('병원저장',name,1);
  renderHospital();
  ['hCode','hName','hManager','hPhone','hAddress','hMemo'].forEach(id=>{byId(id).value='';});
  delete byId('hCode').dataset.originalCode;
  delete byId('hName').dataset.originalName;
}

function hospitalUploadValue(row, keys){
  for(const key of keys){
    const value=row?.[key];
    if(value!==undefined && value!==null)return String(value).trim();
  }
  return '';
}

function nextHospitalCode(usedCodes){
  let n=1,code='';
  do{code=`H${String(n++).padStart(3,'0')}`;}while(usedCodes.has(code));
  return code;
}

function uploadHospitalExcel(event){
  const input=event?.target;
  const file=input?.files?.[0];
  const message=byId('hospitalUploadMessage');
  if(!file)return;
  if(!window.XLSX){
    if(message)message.textContent='엑셀 처리 모듈을 불러오지 못했습니다. Ctrl+F5 후 다시 시도하세요.';
    input.value='';
    return;
  }
  if(!/\.(xlsx|xls)$/i.test(file.name)){
    if(message)message.textContent='xlsx 또는 xls 파일을 선택하세요.';
    input.value='';
    return;
  }
  if(message)message.textContent='파일을 확인하는 중입니다...';
  readWorkbook(file,rows=>{
    ensureV6State();
    ensureHospitalState();
    const valid=[];
    const errors=[];
    const usedCodes=new Set(state.hospitals.map(h=>String(h.code||'').trim()).filter(Boolean));
    rows.forEach((row,index)=>{
      let code=hospitalUploadValue(row,['병원코드','병원 코드','code','Code','CODE']);
      const name=hospitalUploadValue(row,['병원명','병원 명','name','Name','NAME']);
      if(!name){errors.push(`${index+2}행: 병원명 누락`);return;}
      if(!code)code=nextHospitalCode(usedCodes);
      usedCodes.add(code);
      valid.push({
        code,
        name,
        manager:hospitalUploadValue(row,['담당자','담당자명','manager','Manager']),
        phone:hospitalUploadValue(row,['연락처','전화번호','phone','Phone']),
        address:hospitalUploadValue(row,['주소','address','Address']),
        memo:hospitalUploadValue(row,['비고','메모','memo','Memo']),
        row:index+2,
      });
    });
    if(!valid.length){
      if(message)message.textContent=errors.length?`등록할 수 있는 행이 없습니다. ${errors.slice(0,3).join(' / ')}`:'업로드 파일에 데이터가 없습니다.';
      input.value='';
      return;
    }
    let addCount=0,updateCount=0;
    valid.forEach(item=>{
      const found=state.hospitals.find(h=>String(h.code||'').trim()===item.code)||state.hospitals.find(h=>String(h.name||'').trim()===item.name);
      if(found)updateCount++;else addCount++;
    });
    const errorNotice=errors.length?`\n제외 ${errors.length}건: ${errors.slice(0,3).join(', ')}`:'';
    if(!confirm(`병원 정보를 업로드할까요?\n신규 ${addCount}건 / 수정 ${updateCount}건${errorNotice}`)){
      if(message)message.textContent='업로드를 취소했습니다.';
      input.value='';
      return;
    }
    valid.forEach(item=>{
      let hospital=state.hospitals.find(h=>String(h.code||'').trim()===item.code)||state.hospitals.find(h=>String(h.name||'').trim()===item.name);
      if(!hospital){hospital={};state.hospitals.push(hospital);}
      const oldName=String(hospital.name||'').trim();
      migrateHospitalReferences(oldName,item.name);
      Object.assign(hospital,{code:item.code,name:item.name,manager:item.manager,phone:item.phone,address:item.address,memo:item.memo});
    });
    sortHospitalMaster();
    state.history.unshift({time:new Date().toLocaleString('ko-KR'),type:'병원엑셀업로드',content:`신규 ${addCount}건, 수정 ${updateCount}건`,count:valid.length});
    state.history=state.history.slice(0,300);
    saveState('hospital-excel-upload');
    renderHospital();
    window.dispatchEvent(new CustomEvent('dk-state-updated',{detail:{source:'hospital-excel-upload'}}));
    if(message)message.textContent=`업로드 완료: 신규 ${addCount}건, 수정 ${updateCount}건${errors.length?`, 제외 ${errors.length}건`:''}`;
    input.value='';
  });
}

document.addEventListener('DOMContentLoaded',renderHospital);
