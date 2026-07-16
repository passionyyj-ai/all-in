let members=[], meetings=[], attendance=[], teams=[], teamMembers=[], transactions=[], fees=[], feePayments=[], games=[], gameDues=[], matchSeries=[], seriesSets=[], threeTeamSeries=[], threeTeamGames=[], threeTeamFeatureReady=true, settings={monthly_fee:20000};
const openModal=id=>$(id).classList.add('show'),closeModal=id=>$(id).classList.remove('show');
async function init(){
  if(!requireConfig())return;
  const {data:{session}}=await sb.auth.getSession();
  if(session) await enterApp(); else {$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
  sb.auth.onAuthStateChange((_e,s)=>{if(!s){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}});
}
async function login(){
  if(!requireConfig())return;
  const userId=$('email').value.trim();
  const password=$('password').value;
  if(userId!=='admin'||!password)return toast('아이디와 비밀번호를 입력하세요.');
  const {error}=await sb.auth.signInWithPassword({
    email:'admin@allin.club',
    password
  });
  if(error)return toast('아이디 또는 비밀번호가 올바르지 않습니다.');
  await enterApp();
}
async function logout(){await sb.auth.signOut();location.reload()}
async function enterApp(){
  const {data,error}=await sb.rpc('is_admin');if(error||!data){await sb.auth.signOut();return toast('관리자 권한이 없습니다.')}
  $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');await loadAll();subscribeRealtime();
}

function openAdminPasswordModal(){
  $('adminCurrentPassword').value='';
  $('adminNewPassword').value='';
  $('adminNewPasswordConfirm').value='';
  openModal('adminPasswordModal');
}
async function changeAdminPassword(){
  const current=$('adminCurrentPassword').value;
  const next=$('adminNewPassword').value;
  const confirmNext=$('adminNewPasswordConfirm').value;

  if(!current||!next||!confirmNext)return toast('비밀번호를 모두 입력하세요.');
  if(next.length<8)return toast('새 비밀번호는 8자 이상으로 설정하세요.');
  if(next!==confirmNext)return toast('새 비밀번호 확인이 일치하지 않습니다.');
  if(current===next)return toast('현재 비밀번호와 다른 비밀번호를 입력하세요.');

  // 현재 비밀번호 재인증
  const {error:verifyError}=await sb.auth.signInWithPassword({
    email:'admin@allin.club',
    password:current
  });
  if(verifyError)return toast('현재 비밀번호가 올바르지 않습니다.');

  // Supabase Auth 관리자 계정 비밀번호 변경
  const {error:updateError}=await sb.auth.updateUser({password:next});
  if(updateError)return toast('비밀번호 변경 실패: '+updateError.message);

  closeModal('adminPasswordModal');
  toast('관리자 비밀번호를 변경했습니다. 새 비밀번호로 다시 로그인하세요.');

  setTimeout(async()=>{
    await sb.auth.signOut();
    location.reload();
  },1200);
}

async function loadAll(){
  // 기존 운영 데이터는 3팀 확장 기능과 분리해서 먼저 읽는다.
  // 확장 테이블이 아직 없더라도 회원/모임/회비 화면은 계속 정상 표시되어야 한다.
  const coreQueries=await Promise.all([
    sb.from('members').select('*').order('name'),
    sb.from('meetings').select('*').order('meeting_date',{ascending:false}),
    sb.from('attendance').select('*'),
    sb.from('teams').select('*'),
    sb.from('team_members').select('*'),
    sb.from('transactions').select('*').order('tx_date',{ascending:false}),
    sb.from('fees').select('*'),
    sb.from('fee_payments').select('*').order('paid_date',{ascending:false}),
    sb.from('games').select('*'),
    sb.from('game_dues').select('*').order('due_date',{ascending:false}),
    sb.from('match_series').select('*').order('created_at',{ascending:false}),
    sb.from('series_sets').select('*').order('set_no',{ascending:true}),
    sb.from('club_settings').select('*').eq('id',1).maybeSingle()
  ]);

  const requiredIndexes=[0,1,2,3,4,5,6,8,9,10,11,12];
  const coreError=requiredIndexes.map(i=>coreQueries[i]?.error).find(Boolean);
  if(coreError){
    console.error('ALLIN core data load errors',coreQueries.map(q=>q?.error));
    return toast('기존 데이터 로드 오류: '+coreError.message);
  }

  members=coreQueries[0].data||[];
  meetings=coreQueries[1].data||[];
  attendance=coreQueries[2].data||[];
  teams=coreQueries[3].data||[];
  teamMembers=coreQueries[4].data||[];
  transactions=coreQueries[5].data||[];
  fees=coreQueries[6].data||[];
  feePayments=coreQueries[7].error?[]:(coreQueries[7].data||[]);
  if(coreQueries[7].error)console.warn('fee_payments load warning',coreQueries[7].error);
  games=coreQueries[8].data||[];
  gameDues=coreQueries[9].data||[];
  matchSeries=coreQueries[10].data||[];
  seriesSets=coreQueries[11].data||[];
  settings=coreQueries[12].data||{id:1,monthly_fee:20000};

  // 3팀 확장 데이터는 선택적으로 읽는다.
  // SQL 미적용/권한 오류가 있어도 기존 데이터 배열을 건드리지 않는다.
  const optionalQueries=await Promise.all([
    sb.from('three_team_series').select('*').order('created_at',{ascending:false}),
    sb.from('three_team_games').select('*').order('game_no',{ascending:true})
  ]);

  const optionalError=optionalQueries.map(q=>q?.error).find(Boolean);
  if(optionalError){
    threeTeamFeatureReady=false;
    threeTeamSeries=[];
    threeTeamGames=[];
    console.warn('3팀 시리즈 기능 비활성화:',optionalQueries.map(q=>q?.error));
  }else{
    threeTeamFeatureReady=true;
    threeTeamSeries=optionalQueries[0].data||[];
    threeTeamGames=optionalQueries[1].data||[];
  }

  renderAll();
}
let rtStarted=false;
function subscribeRealtime(){
  if(rtStarted)return;rtStarted=true;
  sb.channel('admin-live').on('postgres_changes',{event:'*',schema:'public',table:'attendance'},()=>loadAll()).on('postgres_changes',{event:'*',schema:'public',table:'transactions'},()=>loadAll()).subscribe();
}
function go(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav').forEach(v=>v.classList.toggle('active',v.dataset.view===id));renderAll();scrollTo({top:0,behavior:'smooth'})}
function renderAll(){renderSelects();renderDashboard();renderMembers();renderFinance();renderAttendance();renderGames();renderMatchday();renderReceivables();renderSystemManagement()}
function period(offset=0){const d=new Date();d.setMonth(d.getMonth()+offset);const key=d.toISOString().slice(0,7),rows=transactions.filter(t=>monthKey(t.tx_date)===key);return{key,income:rows.filter(t=>t.tx_type==='income').reduce((s,t)=>s+Number(t.amount),0),expense:rows.filter(t=>t.tx_type==='expense').reduce((s,t)=>s+Number(t.amount),0)}}
function renderDashboard(){
  const cur=period(),prev=period(-1),bal=transactions.reduce((s,t)=>s+(t.tx_type==='income'?Number(t.amount):-Number(t.amount)),0),next=meetings.filter(m=>m.meeting_date>=today()).sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date))[0];
  $('kpis').innerHTML=[['현재 잔액',won(bal),'누적 수입 - 지출'],['당월 수입',won(cur.income),`전월 ${won(prev.income)}`],['당월 지출',won(cur.expense),`전월 ${won(prev.expense)}`],['회원 수',members.length+'명',POSITIONS.map(p=>p+' '+members.filter(m=>m.position===p).length).join(' · ')]].map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div>`).join('');
  $('nextMeetingDate').textContent=next?.meeting_date||'-';const ids=attendance.filter(a=>a.meeting_id===next?.id&&a.attending).map(a=>a.member_id),people=members.filter(m=>ids.includes(m.id));
  $('meetingSummary').innerHTML=next?`<div style="font-size:28px;font-weight:850">${people.length}명 참석 예정</div><div class="row" style="margin-top:10px">${POSITIONS.map(p=>`${badge(p)} <b>${people.filter(x=>x.position===p).length}</b>`).join('')}</div><button class="btn dark" style="width:100%;margin-top:14px" onclick="go('attendance')">참석 현황 보기</button>`:'<div class="empty">예정된 모임이 없습니다.</div>';
  $('recentTx').innerHTML=transactions.slice(0,6).map(t=>`<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb"><span>${t.tx_date} · ${t.category}</span><b class="${t.tx_type==='income'?'money-in':'money-out'}">${t.tx_type==='income'?'+':'-'} ${won(t.amount)}</b></div>`).join('')||'<div class="empty">내역 없음</div>';
}
function syncSecondaryPositions(selected=null){
  if(selected===null)selected=[...document.querySelectorAll('#memberSecondaryPositions input[type=checkbox]:checked')].map(c=>c.value);
  const primary=$('memberPosition').value;
  document.querySelectorAll('#memberSecondaryPositions input[type=checkbox]').forEach(c=>{
    c.disabled=c.value===primary;
    c.checked=c.value!==primary&&selected.includes(c.value);
    c.closest('label').classList.toggle('disabled',c.disabled);
  });
}
function selectedSecondaryPositions(){return [...document.querySelectorAll('#memberSecondaryPositions input[type=checkbox]:checked')].map(c=>c.value).filter(p=>p!==$('memberPosition').value)}
function secondaryPositionBadges(m){const rows=Array.isArray(m.secondary_positions)?m.secondary_positions.filter(p=>POSITIONS.includes(p)&&p!==m.position):[];return rows.length?rows.map(p=>badge(p)).join(' '):'<span class="muted">-</span>'}
function openMember(id){
  const m=members.find(x=>x.id===id);$('memberTitle').textContent=m?'회원 수정':'회원 추가';$('memberId').value=m?.id||'';$('memberName').value=m?.name||'';$('memberBirthYear').value=m?.birth_year||'';$('memberPhone').value=m?.phone||'';$('memberPosition').value=m?.position||'공격';syncSecondaryPositions(m?.secondary_positions||[]);$('memberPin').value='';$('memberPin').placeholder=m?'변경할 때만 새 PIN 입력':'4자리 숫자';openModal('memberModal')
}
async function saveMember(){
  const id=$('memberId').value,name=$('memberName').value.trim(),pin=$('memberPin').value.trim();if(!name)return toast('이름을 입력하세요.');if((!id&&!/^\d{4}$/.test(pin))||(pin&&!/^\d{4}$/.test(pin)))return toast('PIN은 4자리 숫자입니다.');
  const payload={name,birth_year:Number($('memberBirthYear').value)||null,phone:$('memberPhone').value.trim()||null,position:$('memberPosition').value,secondary_positions:selectedSecondaryPositions()};
  let data,error;
  if(id){({data,error}=await sb.from('members').update(payload).eq('id',id));}
  else{
    ({data,error}=await sb.rpc('admin_create_member_v40',{p_name:name,p_birth_year:payload.birth_year,p_phone:payload.phone,p_position:payload.position,p_pin:pin}));
    if(!error){const r=await sb.from('members').update({secondary_positions:payload.secondary_positions}).eq('id',data);if(r.error)error=r.error;}
  }
  if(error)return toast(error.message);
  if(id&&pin){const r=await sb.rpc('admin_set_member_pin',{p_member_id:id,p_pin:pin});if(r.error)return toast(r.error.message)}
  closeModal('memberModal');toast('회원 저장 완료');await loadAll();
}
async function deleteMember(id){if(!confirm('회원을 삭제할까요?'))return;const {error}=await sb.from('members').delete().eq('id',id);if(error)return toast(error.message);await loadAll()}
function renderMembers(){
  const q=$('memberSearchAdmin')?.value.trim()||'',p=$('posFilter')?.value||'';const rows=members.filter(m=>(!q||(m.name+(m.phone||'')).includes(q))&&(!p||(m.position===p||(m.secondary_positions||[]).includes(p))));
  $('memberBody').innerHTML=rows.map(m=>`<tr><td><b>${m.name}</b></td><td>${m.birth_year||'-'}</td><td>${m.phone||'-'}</td><td>${badge(m.position)}</td><td>${secondaryPositionBadges(m)}</td><td>••••</td><td><button class="btn small" onclick="openMember('${m.id}')">수정</button> <button class="btn red small" onclick="deleteMember('${m.id}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="7" class="empty">회원 없음</td></tr>';
}
function renderFinance(){
  if(!$('feeMonth').value)$('feeMonth').value=new Date().toISOString().slice(0,7);if(!$('txMonth').value)$('txMonth').value=new Date().toISOString().slice(0,7);$('feeAmount').value=settings.monthly_fee;
  const cur=period(),prev=period(-1);$('financeKpis').innerHTML=[['전월 수입',won(prev.income)],['전월 지출',won(prev.expense)],['당월 수입',won(cur.income)],['당월 지출',won(cur.expense)]].map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div></div>`).join('');renderFees();renderTx();
}
async function saveFeeAmount(){const amount=Number($('feeAmount').value)||0;const {error}=await sb.from('club_settings').upsert({id:1,monthly_fee:amount});if(error)return toast(error.message);settings.monthly_fee=amount;toast('월 회비 저장');renderFees()}
function renderFees(){
  const month=$('feeMonth').value;
  $('feeBody').innerHTML=members.map(m=>{
    const f=fees.find(x=>x.member_id===m.id&&String(x.fee_month).slice(0,7)===month);
    const payment=f?.payment_id?feePayments.find(x=>x.id===f.payment_id):null;
    const paidInfo=payment?`${payment.paid_date}<br><small>${payment.months_count===1?'1개월 일시납':payment.months_count+'개월 납부'}</small>`:(f?.paid_date||'-');
    let action;
    if(f?.paid&&payment){
      action=`<button class="btn blue small" onclick="openFeePayment('${m.id}','${month}','${payment.id}')">수정</button> <button class="btn red small" onclick="cancelFeePayment('${payment.id}')">취소</button>`;
    }else if(f?.paid){
      action=`<button class="btn red small" onclick="legacyCancelFee('${m.id}','${month}')">취소</button>`;
    }else{
      action=`<button class="btn green small" onclick="openFeePayment('${m.id}','${month}')">납부</button>`;
    }
    return `<tr><td><b>${m.name}</b></td><td>${badge(m.position)}</td><td>${won(settings.monthly_fee)}</td><td>${f?.paid?'<span class="badge" style="background:#dcfce7;color:#166534">납부완료</span>':'<span class="badge">회비 미납</span>'}</td><td>${paidInfo}</td><td>${action}</td></tr>`;
  }).join('');
}
function openFeePayment(memberId,month,paymentId=''){
  const member=members.find(m=>m.id===memberId);
  const payment=paymentId?feePayments.find(x=>x.id===paymentId):null;
  $('feePaymentTitle').textContent=payment?'회비 납부 수정':'회비 납부 등록';
  $('feePaymentId').value=payment?.id||'';
  $('feePaymentMemberId').value=memberId;
  $('feePaymentMemberLabel').value=`${member?.name||'-'} · ${member?.position||'-'}`;
  $('feeStartMonth').value=payment?String(payment.start_month).slice(0,7):month;
  $('feeMonths').value=String(payment?.months_count||1);
  $('feePaidDate').value=payment?.paid_date||today();
  updateFeePaymentAmount();
  openModal('feePaymentModal');
}
function updateFeePaymentAmount(){
  $('feePaymentAmount').value=won(Number(settings.monthly_fee||0)*Number($('feeMonths').value||1));
}
async function saveFeePayment(){
  const paymentId=$('feePaymentId').value||null;
  const memberId=$('feePaymentMemberId').value;
  const start=$('feeStartMonth').value;
  const months=Number($('feeMonths').value);
  const paidDate=$('feePaidDate').value;
  if(!start||!paidDate||![1,3,6,12].includes(months))return toast('납부 정보를 확인하세요.');
  const {error}=await sb.rpc('admin_save_fee_payment',{
    p_payment_id:paymentId,
    p_member_id:memberId,
    p_start_month:start+'-01',
    p_months_count:months,
    p_paid_date:paidDate
  });
  if(error){console.error('admin_save_fee_payment',error);return toast('회비 저장 실패: '+error.message)}
  closeModal('feePaymentModal');
  toast(paymentId?'회비 납부 수정 완료':'회비 납부 등록 완료');
  await loadAll();
}
async function cancelFeePayment(paymentId){
  const payment=feePayments.find(x=>x.id===paymentId);
  const member=members.find(x=>x.id===payment?.member_id);
  if(!confirm(`${member?.name||'회원'}의 ${payment?.months_count||''}개월 회비 납부 처리를 취소할까요?
연결된 수입 내역도 함께 삭제됩니다.`))return;
  const {error}=await sb.rpc('admin_cancel_fee_payment',{p_payment_id:paymentId});
  if(error){console.error('admin_cancel_fee_payment',error);return toast('회비 취소 실패: '+error.message)}
  toast('회비 납부 취소 완료');
  await loadAll();
}
async function legacyCancelFee(memberId,month){
  const {error}=await sb.rpc('admin_set_fee',{p_member_id:memberId,p_month:month+'-01',p_paid:false});
  if(error)return toast(error.message);
  await loadAll();
}
function openTx(id){
  const t=id?transactions.find(x=>x.id===id):null;
  if(t && t.source!=='manual') return toast('자동 생성 내역은 직접 수정할 수 없습니다.');
  $('txModalTitle').textContent=t?'입출금 수정':'입출금 등록';
  $('txSaveBtn').textContent=t?'수정 저장':'등록';
  $('txId').value=t?.id||'';
  $('txDate').value=t?.tx_date||today();
  $('txType').value=t?.tx_type||'income';
  $('txCategory').value=t?.category||'';
  $('txTarget').value=t?.target||'';
  $('txAmount').value=t?.amount||'';
  $('txMemo').value=t?.memo||'';
  openModal('txModal')
}
async function saveTx(){
  const id=$('txId').value;
  const amount=Number($('txAmount').value);
  if(!$('txDate').value||!$('txCategory').value.trim()||amount<=0)return toast('필수값을 확인하세요.');
  const payload={
    tx_date:$('txDate').value,
    tx_type:$('txType').value,
    category:$('txCategory').value.trim(),
    target:$('txTarget').value.trim()||null,
    amount,
    memo:$('txMemo').value.trim()||null
  };
  let result;
  if(id){
    const t=transactions.find(x=>x.id===id);
    if(!t||t.source!=='manual')return toast('자동 생성 내역은 수정할 수 없습니다.');
    result=await sb.from('transactions').update(payload).eq('id',id);
  }else{
    result=await sb.from('transactions').insert({...payload,source:'manual'});
  }
  if(result.error)return toast(result.error.message);
  closeModal('txModal');
  toast(id?'입출금 내역 수정 완료':'입출금 등록 완료');
  await loadAll()
}
async function deleteTx(id){
  const t=transactions.find(x=>x.id===id);
  if(!t)return;
  if(t.source!=='manual')return toast('자동 생성 내역은 해당 원본 메뉴에서 취소하세요.');
  if(!confirm('내역을 삭제할까요?'))return;
  const {error}=await sb.from('transactions').delete().eq('id',id);
  if(error)return toast(error.message);
  await loadAll()
}
function renderTx(){const month=$('txMonth').value,type=$('txTypeFilter').value,rows=transactions.filter(t=>monthKey(t.tx_date)===month&&(!type||t.tx_type===type));$('txBody').innerHTML=rows.map(t=>`<tr><td>${t.tx_date}</td><td>${t.tx_type==='income'?'수입':'지출'}</td><td>${t.category}</td><td>${t.target||'-'}</td><td class="${t.tx_type==='income'?'money-in':'money-out'}">${t.tx_type==='income'?'+':'-'} ${won(t.amount)}</td><td>${t.memo||'-'}</td><td>${t.source==='manual'?`<button class="btn blue small" onclick="openTx('${t.id}')">수정</button> <button class="btn red small" onclick="deleteTx('${t.id}')">삭제</button>`:`<span class="badge">${t.source==='fee'?'회비 자동':'게임비 자동'}</span>`}</td></tr>`).join('')||'<tr><td colspan="7" class="empty">내역 없음</td></tr>'}
function nextSundayFrom(date){const d=new Date((date||today())+'T12:00:00');const diff=(7-d.getDay())%7;d.setDate(d.getDate()+diff);return d.toISOString().slice(0,10)}
async function createMeeting(){let base=meetings[0]?.meeting_date||today();if(meetings[0]){const d=new Date(base+'T12:00:00');d.setDate(d.getDate()+7);base=d.toISOString().slice(0,10)}const date=nextSundayFrom(base);const {error}=await sb.from('meetings').insert({meeting_date:date,status:'open'});if(error)return toast(error.code==='23505'?'이미 생성된 모임입니다.':error.message);toast('다음 모임 생성');await loadAll()}
function renderSelects(){
  const opts=meetings.map(m=>`<option value="${m.id}">${m.meeting_date}</option>`).join('');
  const ids=['meetingSelect','gameMeetingSelect','matchMeetingSelect'];
  const olds=Object.fromEntries(ids.map(id=>[id,$(id)?.value||'']));
  ids.forEach(id=>{if($(id))$(id).innerHTML=opts});
  ids.forEach(id=>{if($(id)&&meetings.some(m=>m.id===olds[id]))$(id).value=olds[id]});
}
function currentMeeting(id='meetingSelect'){return meetings.find(m=>m.id===$(id).value)||meetings[0]}
function attendingPeople(m){const ids=attendance.filter(a=>a.meeting_id===m?.id&&a.attending).map(a=>a.member_id);return members.filter(x=>ids.includes(x.id))}
function renderAttendance(){
  const m=currentMeeting();if(!m){$('attendanceSummary').innerHTML='<div class="empty">모임 없음</div>';return}const people=attendingPeople(m);
  $('attendanceSummary').innerHTML=`<div class="grid g4">${POSITIONS.map(p=>`<div class="kpi"><div class="label">${p}</div><div class="value">${people.filter(x=>x.position===p).length}명</div></div>`).join('')}</div><div class="row" style="margin-top:12px">${people.map(x=>`<span class="badge ${posClass[x.position]}">${x.name} · ${x.position}</span>`).join('')||'<span class="empty">참석자 없음</span>'}</div>`;renderTeams();
}
function openAttendance(){const m=currentMeeting();if(!m)return;$('attendanceChecks').innerHTML=members.map(x=>{const yes=attendance.some(a=>a.meeting_id===m.id&&a.member_id===x.id&&a.attending);return`<label class="row" style="border:1px solid #e5e7eb;border-radius:12px;padding:10px"><input type="checkbox" value="${x.id}" ${yes?'checked':''}><b>${x.name}</b>${badge(x.position)}</label>`}).join('');openModal('attendanceModal')}
async function saveAttendance(){const m=currentMeeting(),checked=[...$('attendanceChecks').querySelectorAll('input:checked')].map(x=>x.value);const {error}=await sb.rpc('admin_replace_attendance',{p_meeting_id:m.id,p_member_ids:checked});if(error)return toast(error.message);closeModal('attendanceModal');await loadAll()}
async function generateTeams(mode='balanced'){
  const m=currentMeeting();if(!m)return;
  const active=matchSeries.find(s=>s.meeting_id===m.id&&s.status==='active')||threeTeamSeries.find(s=>s.meeting_id===m.id&&s.status==='active');
  if(active)return toast('진행 중인 시리즈를 먼저 종료하세요.');
  const rpc=mode==='random'?'admin_generate_random_teams_v51':'admin_generate_balanced_teams_v51';
  const {data,error}=await sb.rpc(rpc,{p_meeting_id:m.id});
  if(error)return toast(error.message);
  toast(`${mode==='random'?'완전 랜덤':'포지션 균형'} 팀 ${data?.team_count||0}개 생성`);
  await loadAll()
}
function teamMemberRow(x,currentTeamId,ts,locked=false){
  const options=ts.map(t=>`<option value="${t.id}" ${t.id===currentTeamId?'selected':''}>${t.team_name}</option>`).join('');
  return `<div class="team-member team-member-manage"><div><b>${x.name}</b> ${badge(x.position)}</div><select class="team-assign-select" ${locked?'disabled':''} onchange="changeMemberTeam('${x.id}',this.value)">${options}</select></div>`;
}
async function changeMemberTeam(memberId,teamId){
  const m=currentMeeting();if(!m||!teamId)return;
  const active=matchSeries.find(s=>s.meeting_id===m.id&&s.status==='active')||threeTeamSeries.find(s=>s.meeting_id===m.id&&s.status==='active');
  if(active)return toast('진행 중인 시리즈에서는 팀을 변경할 수 없습니다.');
  const {error}=await sb.rpc('admin_assign_member_team_v51',{p_meeting_id:m.id,p_member_id:memberId,p_team_id:teamId});
  if(error)return toast(error.message);
  toast('팀 배정을 변경했습니다.');await loadAll();
}
function renderTeams(){
  const m=currentMeeting();if(!m)return;
  const ts=teams.filter(t=>t.meeting_id===m.id).sort((a,b)=>a.team_no-b.team_no);
  const active=matchSeries.find(s=>s.meeting_id===m.id&&s.status==='active')||threeTeamSeries.find(s=>s.meeting_id===m.id&&s.status==='active');
  const attending=attendingPeople(m),used=teamMembers.filter(tm=>ts.some(t=>t.id===tm.team_id)).map(tm=>tm.member_id),unassigned=attending.filter(x=>!used.includes(x.id));
  $('teamArea').innerHTML=ts.length?`<div class="team-summary">${ts.map(t=>`<span class="badge">${t.team_name} ${teamMembers.filter(tm=>tm.team_id===t.id).length}명</span>`).join('')}</div><div class="team-grid">${ts.map(t=>`<div class="team-card"><h3>${t.team_name} <small>${teamMembers.filter(tm=>tm.team_id===t.id).length}명</small></h3>${teamMembers.filter(tm=>tm.team_id===t.id).map(tm=>members.find(x=>x.id===tm.member_id)).filter(Boolean).map(x=>teamMemberRow(x,t.id,ts,!!active)).join('')||'<div class="empty compact">배정된 회원 없음</div>'}</div>`).join('')}</div>${unassigned.length?`<div class="notice warning" style="margin-top:12px"><b>미배정 ${unassigned.length}명:</b> ${unassigned.map(x=>x.name).join(', ')} · 자동편성을 다시 실행하세요.</div>`:'<div class="notice success" style="margin-top:12px"><b>대기인원 0명</b> · 참석자 전원이 팀에 배정되었습니다.</div>'}`:'<div class="empty">팀을 생성해 주세요.</div>';
}
function gameTeamsForMeeting(meetingId){
  return teams.filter(t=>t.meeting_id===meetingId).sort((a,b)=>a.team_no-b.team_no);
}
function fillGameTeamSelects(prefix,meetingId,selectedA='',selectedB=''){
  const ts=gameTeamsForMeeting(meetingId);
  const a=$(prefix==='new'?'newGameTeamA':'editGameTeamA');
  const b=$(prefix==='new'?'newGameTeamB':'editGameTeamB');
  if(!a||!b)return;
  a.innerHTML=ts.map(t=>`<option value="${t.id}" ${t.id===selectedA?'selected':''}>${t.team_name}</option>`).join('');
  b.innerHTML=ts.map(t=>`<option value="${t.id}" ${t.id===selectedB?'selected':''}>${t.team_name}</option>`).join('');
  if(!selectedA&&ts[0])a.value=ts[0].id;
  if(!selectedB&&ts[1])b.value=ts[1].id;
  syncGameTeamOptions(prefix);
}
function syncGameTeamOptions(prefix){
  const a=$(prefix==='new'?'newGameTeamA':'editGameTeamA');
  const b=$(prefix==='new'?'newGameTeamB':'editGameTeamB');
  if(!a||!b)return;
  [...a.options].forEach(o=>o.disabled=o.value===b.value);
  [...b.options].forEach(o=>o.disabled=o.value===a.value);
  if(a.value===b.value){
    const next=[...b.options].find(o=>o.value!==a.value);
    if(next)b.value=next.value;
  }
}
function addGame(){
  const m=currentMeeting('gameMeetingSelect'),ts=gameTeamsForMeeting(m?.id);
  if(!m)return toast('모임을 선택하세요.');
  if(ts.length<2)return toast('먼저 2개 이상의 팀을 생성하세요.');
  $('newGameMeetingId').value=m.id;
  fillGameTeamSelects('new',m.id);
  openModal('gameCreateModal');
}
async function saveNewGame(){
  const meetingId=$('newGameMeetingId').value;
  const teamA=$('newGameTeamA').value,teamB=$('newGameTeamB').value;
  if(!meetingId||!teamA||!teamB)return toast('경기 팀을 선택하세요.');
  if(teamA===teamB)return toast('서로 다른 두 팀을 선택하세요.');
  const {error}=await sb.from('games').insert({meeting_id:meetingId,team_a:teamA,team_b:teamB});
  if(error)return toast(error.message);
  closeModal('gameCreateModal');toast('경기를 생성했습니다.');await loadAll();
}
function teamName(id){return teams.find(t=>t.id===id)?.team_name||'-'}
function openScore(id){
  const g=games.find(x=>x.id===id);if(!g)return;
  $('scoreGameId').value=id;$('scoreTeamALabel').textContent=teamName(g.team_a);$('scoreTeamBLabel').textContent=teamName(g.team_b);
  $('scoreA').value=g.score_a??'';$('scoreB').value=g.score_b??'';openModal('scoreModal')
}
async function saveScore(){
  const id=$('scoreGameId').value,a=Number($('scoreA').value),b=Number($('scoreB').value);
  if(Number.isNaN(a)||Number.isNaN(b)||a<0||b<0)return toast('점수를 확인하세요.');
  if(a===b)return toast('동점은 저장할 수 없습니다.');
  const {error}=await sb.rpc('admin_set_game_score',{p_game_id:id,p_score_a:a,p_score_b:b});
  if(error)return toast(error.message);closeModal('scoreModal');toast('점수·승패 저장 / 게임비 청구 생성');await loadAll()
}
async function clearGameResult(id){
  if(!confirm('경기 결과를 취소할까요? 생성된 게임비 청구도 삭제됩니다.'))return;
  const {error}=await sb.rpc('admin_clear_game_result',{p_game_id:id});if(error)return toast(error.message);await loadAll()
}
async function deleteGame(id){
  if(!confirm('경기를 삭제할까요? 관련 게임비 청구도 삭제됩니다.'))return;
  const {error}=await sb.rpc('admin_delete_game',{p_game_id:id});if(error)return toast(error.message);await loadAll()
}
function renderGames(){
  const m=currentMeeting('gameMeetingSelect');if(!m){$('gameList').innerHTML='<div class="empty">모임 없음</div>';return}
  const rows=games.filter(g=>g.meeting_id===m.id);
  $('gameList').innerHTML=rows.map((g,i)=>`<div class="row" style="justify-content:space-between;padding:11px 0;border-bottom:1px solid #e5e7eb">
    <div><b>${i+1}경기 · ${teamName(g.team_a)} ${g.score_a??'-'} : ${g.score_b??'-'} ${teamName(g.team_b)}</b>
    <div style="font-size:12px;color:#6b7280;margin-top:3px">${g.winner_team_id?`승리 ${teamName(g.winner_team_id)}`:'결과 미입력'}</div></div>
    <div class="row"><button class="btn blue small" onclick="openScore('${g.id}')">결과 입력</button>${g.winner_team_id?`<button class="btn small" onclick="clearGameResult('${g.id}')">결과취소</button>`:''}<button class="btn red small" onclick="deleteGame('${g.id}')">삭제</button></div>
  </div>`).join('')||'<div class="empty">경기 없음</div>';
  const dues=gameDues.filter(d=>d.meeting_id===m.id),paid=dues.filter(d=>d.status==='paid'),unpaid=dues.filter(d=>d.status==='unpaid');
  $('gameFeeSummary').innerHTML=dues.length?`<div class="grid g4">
    <div class="kpi"><div class="label">총 청구</div><div class="value">${won(dues.reduce((s,d)=>s+Number(d.amount),0))}</div></div>
    <div class="kpi"><div class="label">게임비 잔액</div><div class="value">${won(unpaid.reduce((s,d)=>s+Number(d.amount),0))}</div></div>
    <div class="kpi"><div class="label">납부</div><div class="value">${won(paid.reduce((s,d)=>s+Number(d.amount),0))}</div></div>
    <div class="kpi"><div class="label">청구 건수</div><div class="value">${dues.length}건</div></div>
  </div>`:'<div class="empty">점수를 저장하면 일반 패배는 2,000원, 8점 차 이상 콜드게임 패배는 4,000원 청구가 생성됩니다. 실제 입금 전에는 수입에 반영되지 않습니다.</div>';
}
init();


function matchMeeting(){return meetings.find(m=>m.id===$('matchMeetingSelect')?.value)||meetings[0]}
function prepareMatchday(){loadAll();toast('운영 화면을 새로고침했습니다.')}
function seriesForMeeting(m){return matchSeries.filter(s=>s.meeting_id===m?.id)}
function threeSeriesForMeeting(m){return threeTeamSeries.filter(s=>s.meeting_id===m?.id)}
function activeThreeSeries(m){return threeSeriesForMeeting(m).find(s=>s.status==='active')}
function anyActiveSeries(m){return activeSeries(m)||activeThreeSeries(m)}
function threeGamesForSeries(id){return threeTeamGames.filter(g=>g.series_id===id).sort((a,b)=>a.game_no-b.game_no)}

function activeSeries(m){return seriesForMeeting(m).find(s=>s.status==='active')}
function rosterNames(roster){return (roster||[]).map(id=>members.find(m=>m.id===id)?.name||'알 수 없음')}
function renderMatchday(){
  if(!$('matchdaySummary'))return;
  const m=matchMeeting();
  if(!m){$('matchdaySummary').innerHTML='<div class="empty">모임 없음</div>';return}
  const people=attendingPeople(m);
  const ts=teams.filter(t=>t.meeting_id===m.id).sort((a,b)=>a.team_no-b.team_no);
  const allSeries=seriesForMeeting(m);
  const active=activeSeries(m);
  const activeThree=activeThreeSeries(m);
  const completed=allSeries.filter(s=>s.status==='completed').length+threeSeriesForMeeting(m).filter(s=>s.status==='completed').length;
  const locked=!!(active||activeThree);

  $('matchdaySummary').innerHTML=`<div class="grid g4">
    <div class="kpi"><div class="label">모임일</div><div class="value">${m.meeting_date}</div></div>
    <div class="kpi"><div class="label">참석자</div><div class="value">${people.length}명</div></div>
    <div class="kpi"><div class="label">현재 팀</div><div class="value">${ts.length}팀</div></div>
    <div class="kpi"><div class="label">완료 시리즈</div><div class="value">${completed}회</div></div>
  </div>
  <div class="row" style="margin-top:12px">${POSITIONS.map(p=>`${badge(p)} <b>${people.filter(x=>x.position===p).length}명</b>`).join('')}</div>`;

  $('teamGenerationStatus').textContent=locked?'시리즈 진행 중 · 재편성 잠금':'팀 편성 가능';
  $('matchdayTeams').innerHTML=ts.length?`<div class="team-grid">${ts.map(t=>`<div class="team-card">
    <h3>${t.team_name}</h3>
    ${teamMembers.filter(tm=>tm.team_id===t.id).map(tm=>members.find(x=>x.id===tm.member_id)).filter(Boolean).map(x=>teamMemberRow(x,t.id,ts,locked)).join('')}
  </div>`).join('')}</div>`:'<div class="empty">참석자를 확인하고 팀을 편성하세요.</div>';

  if(activeThree){
    $('seriesStartArea').innerHTML=`<div class="notice"><b>${activeThree.series_no}차 3팀 단판 시리즈 진행 중</b><br>
      ${activeThree.team_1_name} · ${activeThree.team_2_name} · ${activeThree.team_3_name}
      · ${activeThree.cycle_no}회차${activeThree.reset_count?` · 초기화 ${activeThree.reset_count}회`:''}</div>`;
  }else if(active){
    $('seriesStartArea').innerHTML=`<div class="notice"><b>${active.series_no}차 시리즈 진행 중</b><br>${active.team_a_name} vs ${active.team_b_name} · ${active.best_of===3?'3판 2승제':'5판 3승제'}</div>`;
  }else if(ts.length===3){
    $('seriesStartArea').innerHTML=`<div class="notice"><b>3팀 단판 승자연전</b><br>
      1경기 ${ts[0].team_name} vs ${ts[1].team_name} → 승자 vs ${ts[2].team_name} → 우승 확정 후 최종 패자 결정전<br>
      1:1:1이면 시리즈를 초기화하고 재경기합니다.</div>
      ${threeTeamFeatureReady
        ?'<button class="btn dark" style="width:100%;margin-top:12px" onclick="startThreeTeamSeries()">3팀 단판 시리즈 시작</button>'
        :'<div class="notice warning" style="margin-top:12px"><b>3팀 기능 준비 필요</b><br>Supabase에서 ALLIN_V55_Three_Team_Series_Update.sql을 실행하세요. 기존 회원·회비·모임 기능은 정상 사용 가능합니다.</div>'}`;
  }else if(ts.length>=2){
    const refereeRequired=people.length<12;
    $('seriesStartArea').innerHTML=`<div class="form-grid">
      <div class="field"><label>A팀</label><select id="seriesTeamA">${ts.map(t=>`<option value="${t.id}">${t.team_name}</option>`).join('')}</select></div>
      <div class="field"><label>B팀</label><select id="seriesTeamB">${ts.map((t,i)=>`<option value="${t.id}" ${i===1?'selected':''}>${t.team_name}</option>`).join('')}</select></div>
      <div class="field"><label>경기 방식</label><select id="seriesBestOf"><option value="3">3판 2승제</option><option value="5">5판 3승제</option></select></div>
      ${refereeRequired?`<div class="field"><label>심판 *</label><select id="seriesReferee"><option value="">심판 선택</option>${people.map(x=>`<option value="${x.id}">${x.name}</option>`).join('')}</select></div>`:''}
    </div>
    ${refereeRequired?'<div class="notice" style="margin-top:10px">12명 미만 경기에서는 참석자 중 한 명을 심판으로 지정합니다. 심판은 게임비와 경기횟수에서 제외됩니다.</div>':''}
    <button class="btn dark" style="width:100%;margin-top:12px" onclick="startSeries()">시리즈 시작</button>`;
  }else{
    $('seriesStartArea').innerHTML='<div class="empty">2개 이상의 팀을 먼저 편성하세요.</div>';
  }

  if(activeThree) renderThreeTeamArea(m,activeThree);
  else renderSeriesArea(m,active);

  renderSeriesHistory(m);
}
async function startThreeTeamSeries(){
  if(!threeTeamFeatureReady)return toast('3팀 시리즈 SQL 업데이트를 먼저 실행하세요.');
  const m=matchMeeting();
  if(!m)return toast('모임을 선택하세요.');
  const ts=teams.filter(t=>t.meeting_id===m.id);
  if(ts.length!==3)return toast('3팀 단판 시리즈는 정확히 3팀일 때만 시작할 수 있습니다.');
  const {error}=await sb.rpc('admin_start_three_team_series',{p_meeting_id:m.id});
  if(error)return toast(error.message);
  toast('3팀 단판 시리즈를 시작했습니다.');
  await loadAll();
}
function renderThreeTeamArea(m,s){
  const rows=threeGamesForSeries(s.id);
  const pending=rows.find(g=>g.score_a===null||g.score_b===null);
  const fee=s.reset_count>0?4000:2000;
  const phaseLabel=s.phase==='loser_final'?'최종 패자 결정전':'우승팀 결정';
  $('seriesArea').innerHTML=`${active.referee_name?`<div class="referee-banner"><b>심판</b><span>${active.referee_name}</span><small>게임비·경기횟수 제외</small></div>`:''}<div class="grid g4">
    <div class="kpi"><div class="label">진행 회차</div><div class="value">${s.cycle_no}회차</div></div>
    <div class="kpi"><div class="label">초기화</div><div class="value">${s.reset_count}회</div></div>
    <div class="kpi"><div class="label">현재 단계</div><div class="value" style="font-size:18px">${phaseLabel}</div></div>
    <div class="kpi"><div class="label">최종 게임비</div><div class="value">${won(fee)}</div></div>
  </div>
  ${s.champion_name?`<div class="notice success" style="margin-top:12px"><b>시리즈 우승: ${s.champion_name}</b><br>남은 두 팀의 최종 패자 결정전을 진행하세요.</div>`:''}
  <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>경기</th><th>회차</th><th>대진</th><th>점수</th><th>결과</th></tr></thead><tbody>
  ${rows.map(x=>`<tr>
    <td>${x.game_no}경기${x.phase==='loser_final'?' · 패자결정':''}</td>
    <td>${x.cycle_no}회차</td>
    <td>${x.team_a_name} vs ${x.team_b_name}</td>
    <td>${x.score_a===null?'-':`${x.score_a} : ${x.score_b}`}</td>
    <td>${x.winner_team_id?`${x.winner_team_id===x.team_a_id?x.team_a_name:x.team_b_name} 승`:'대기'}</td>
  </tr>`).join('')}
  </tbody></table></div>
  ${pending?`<button class="btn blue" style="width:100%;margin-top:12px" onclick="openThreeTeamScore('${s.id}')">
    ${pending.game_no}경기 · ${pending.team_a_name} vs ${pending.team_b_name} 결과 입력
  </button>`:'<div class="empty" style="margin-top:12px">다음 경기 생성 중입니다.</div>'}
  <button class="btn red small" style="width:100%;margin-top:8px" onclick="cancelThreeTeamSeries('${s.id}')">3팀 시리즈 취소</button>`;
}
function openThreeTeamScore(seriesId){
  const s=threeTeamSeries.find(x=>x.id===seriesId);if(!s)return;
  const g=threeGamesForSeries(seriesId).find(x=>x.score_a===null||x.score_b===null);if(!g)return;
  $('threeTeamSeriesId').value=seriesId;
  $('threeTeamScoreTitle').textContent=`${g.game_no}경기 · ${g.phase==='loser_final'?'최종 패자 결정전':'단판 경기'}`;
  $('threeTeamALabel').textContent=g.team_a_name;
  $('threeTeamBLabel').textContent=g.team_b_name;
  $('threeTeamScoreA').value='';
  $('threeTeamScoreB').value='';
  openModal('threeTeamScoreModal');
}
async function saveThreeTeamGame(){
  const id=$('threeTeamSeriesId').value;
  const a=Number($('threeTeamScoreA').value),b=Number($('threeTeamScoreB').value);
  if(Number.isNaN(a)||Number.isNaN(b)||a<0||b<0)return toast('점수를 확인하세요.');
  if(a===b)return toast('동점은 저장할 수 없습니다.');
  const {data,error}=await sb.rpc('admin_record_three_team_game',{p_series_id:id,p_score_a:a,p_score_b:b});
  if(error)return toast(error.message);
  closeModal('threeTeamScoreModal');
  if(data?.completed){
    toast(`${data.champion_name} 우승 · ${data.final_loser_name} 최종 패배 · 1인당 ${won(data.fee_amount)} 청구`);
  }else if(data?.reset){
    toast('A·B·C팀이 1승씩 기록해 시리즈가 초기화되었습니다. 재경기를 시작합니다.');
  }else if(data?.phase==='loser_final'){
    toast(`${data.champion_name} 우승 확정 · 최종 패자 결정전을 진행하세요.`);
  }else{
    toast('단판 경기 결과를 저장했습니다.');
  }
  await loadAll();
}
async function cancelThreeTeamSeries(id){
  if(!confirm('3팀 시리즈를 취소할까요? 입력한 단판 기록도 삭제됩니다.'))return;
  const {error}=await sb.rpc('admin_cancel_three_team_series',{p_series_id:id});
  if(error)return toast(error.message);
  toast('3팀 시리즈를 취소했습니다.');
  await loadAll();
}
async function startSeries(){
  const m=matchMeeting();
  const teamA=$('seriesTeamA')?.value;
  const teamB=$('seriesTeamB')?.value;
  const bestOf=Number($('seriesBestOf')?.value||3);
  const refereeId=$('seriesReferee')?.value||null;
  const people=attendingPeople(m);

  if(!teamA||!teamB||teamA===teamB)return toast('서로 다른 두 팀을 선택하세요.');
  if(people.length<12&&!refereeId)return toast('12명 미만 경기에서는 심판을 선택하세요.');

  const {data,error}=await sb.rpc('admin_start_match_series_v57',{
    p_meeting_id:m.id,
    p_team_a_id:teamA,
    p_team_b_id:teamB,
    p_best_of:bestOf,
    p_referee_member_id:refereeId
  });

  if(error)return toast(error.message);
  const referee=members.find(x=>x.id===refereeId);
  toast(`${bestOf===3?'3판 2승제':'5판 3승제'} 시리즈 시작${referee?` · 심판 ${referee.name}`:''}`);
  await loadAll();
}
function renderSeriesArea(m,active){
  if(!active){$('seriesArea').innerHTML='<div class="empty">진행 중인 시리즈가 없습니다.</div>';return}
  const sets=seriesSets.filter(x=>x.series_id===active.id).sort((a,b)=>a.set_no-b.set_no);
  const target=active.best_of===3?2:3;
  const nextNo=sets.length+1;
  $('seriesArea').innerHTML=`<div class="grid g4">
    <div class="kpi"><div class="label">${active.team_a_name}</div><div class="value">${active.team_a_wins}승</div></div>
    <div class="kpi"><div class="label">${active.team_b_name}</div><div class="value">${active.team_b_wins}승</div></div>
    <div class="kpi"><div class="label">승리 조건</div><div class="value">${target}승</div></div>
    <div class="kpi"><div class="label">다음 세트</div><div class="value">${nextNo}세트</div></div>
  </div>
  <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>세트</th><th>${active.team_a_name}</th><th>${active.team_b_name}</th><th>결과</th></tr></thead><tbody>
  ${sets.map(x=>`<tr><td>${x.set_no}세트</td><td><b>${x.score_a}</b></td><td><b>${x.score_b}</b></td><td>${x.cold_game?'<span class="badge" style="background:#fee2e2;color:#991b1b">8:0 콜드</span>':(x.winner_side==='A'?active.team_a_name:active.team_b_name)+' 승'}</td></tr>`).join('')}
  </tbody></table></div>
  <button class="btn blue" style="width:100%;margin-top:12px" onclick="openSeriesSet('${active.id}')">${nextNo}세트 점수 입력</button>
  <button class="btn red small" style="width:100%;margin-top:8px" onclick="cancelSeries('${active.id}')">시리즈 취소</button>`;
}
function openSeriesSet(seriesId){
  const s=matchSeries.find(x=>x.id===seriesId);if(!s)return;
  const setNo=seriesSets.filter(x=>x.series_id===seriesId).length+1;
  $('seriesSetId').value=seriesId;
  $('seriesSetTitle').textContent=`${s.series_no}차 시리즈 · ${setNo}세트`;
  $('seriesTeamALabel').textContent=s.team_a_name;
  $('seriesTeamBLabel').textContent=s.team_b_name;
  $('seriesScoreA').value='';$('seriesScoreB').value='';
  openModal('seriesSetModal')
}
async function saveSeriesSet(){
  const id=$('seriesSetId').value,a=Number($('seriesScoreA').value),b=Number($('seriesScoreB').value);
  if(Number.isNaN(a)||Number.isNaN(b)||a<0||b<0)return toast('점수를 확인하세요.');
  if(a===b)return toast('동점은 저장할 수 없습니다.');
  const {data,error}=await sb.rpc('admin_record_series_set',{p_series_id:id,p_score_a:a,p_score_b:b});
  if(error)return toast(error.message);
  closeModal('seriesSetModal');
  if(data?.completed)toast(`${data.cold_ended?'8:0 콜드패 · 시리즈 즉시 종료':'시리즈 종료'} · ${data.winner_name} 승 / 패배팀 게임비 ${won(data.fee_amount)} 청구`);
  else toast('세트 결과 저장');
  await loadAll()
}
async function cancelSeries(id){
  if(!confirm('이 시리즈를 취소할까요? 입력된 세트 기록도 삭제됩니다.'))return;
  const {error}=await sb.rpc('admin_cancel_match_series',{p_series_id:id});
  if(error)return toast(error.message);
  toast('시리즈 취소 완료');await loadAll()
}
function renderSeriesHistory(m){
  const rows=seriesForMeeting(m).filter(s=>s.status==='completed').sort((a,b)=>b.series_no-a.series_no);
  const triple=threeSeriesForMeeting(m).filter(s=>s.status==='completed').sort((a,b)=>b.series_no-a.series_no);
  const normalHtml=rows.map(s=>{
    const sets=seriesSets.filter(x=>x.series_id===s.id).sort((a,b)=>a.set_no-b.set_no);
    return `<div class="row" style="justify-content:space-between;padding:11px 0;border-bottom:1px solid #e5e7eb">
      <div><b>${s.series_no}차 · ${s.team_a_name} ${s.team_a_wins}:${s.team_b_wins} ${s.team_b_name}</b>
      <div style="font-size:12px;color:#6b7280">${s.winner_name} 승 · ${s.loser_name} 패 · ${won(s.fee_amount)} 청구 · ${sets.length}세트</div></div>
    </div>`;
  }).join('');
  const tripleHtml=triple.map(s=>`<div class="row" style="justify-content:space-between;padding:11px 0;border-bottom:1px solid #e5e7eb">
    <div><b>${s.series_no}차 · 3팀 단판 시리즈</b>
    <div style="font-size:12px;color:#6b7280">${s.champion_name} 우승 · ${s.final_loser_name} 최종 패배 · 초기화 ${s.reset_count}회 · ${won(s.fee_amount)} 청구</div></div>
  </div>`).join('');
  $('seriesHistory').innerHTML=(tripleHtml+normalHtml)||'<div class="empty">종료된 시리즈가 없습니다.</div>';
}
function memberStats(memberId){
  const att=attendance.filter(a=>a.member_id===memberId&&a.attending).length;
  const played=teamMembers.filter(tm=>tm.member_id===memberId).flatMap(tm=>games.filter(g=>g.team_a===tm.team_id||g.team_b===tm.team_id)).filter(g=>g.winner_team_id);
  const wins=played.filter(g=>teamMembers.some(tm=>tm.member_id===memberId&&tm.team_id===g.winner_team_id)).length;
  return {attendance:att,games:played.length,wins,winRate:played.length?Math.round(wins/played.length*100):0}
}
function renderReceivables(){
  if(!$('duesBody'))return;
  if(!$('duesMonth').value)$('duesMonth').value=new Date().toISOString().slice(0,7);
  const status=$('duesStatusFilter').value,month=$('duesMonth').value;
  const monthRows=gameDues.filter(d=>monthKey(d.due_date)===month);

  const meetingGroups={};
  monthRows.forEach(d=>{
    const key=d.meeting_id||d.due_date;
    const meeting=meetings.find(m=>m.id===d.meeting_id);
    if(!meetingGroups[key])meetingGroups[key]={
      date:meeting?.meeting_date||d.due_date,
      rows:[]
    };
    meetingGroups[key].rows.push(d);
  });

  const meetingHtml=Object.values(meetingGroups).sort((a,b)=>b.date.localeCompare(a.date)).map(g=>{
    const grouped={};
    g.rows.forEach(d=>{
      const m=members.find(x=>x.id===d.member_id);
      if(!grouped[d.member_id])grouped[d.member_id]={name:m?.name||'-',total:0,paid:0,unpaid:0};
      grouped[d.member_id].total+=Number(d.amount);
      if(d.status==='paid')grouped[d.member_id].paid+=Number(d.amount);
      else grouped[d.member_id].unpaid+=Number(d.amount);
    });
    let people=Object.values(grouped);
    if(status==='unpaid')people=people.filter(x=>x.unpaid>0);
    if(status==='paid')people=people.filter(x=>x.paid>0);
    const unpaidTotal=people.reduce((s,x)=>s+x.unpaid,0);
    return `<div class="card" style="margin-bottom:12px">
      <div class="row" style="justify-content:space-between">
        <div><b>${g.date} 모임</b><div style="font-size:12px;color:#6b7280;margin-top:3px">게임비 ${won(unpaidTotal)}</div></div>
        <button class="btn blue small" onclick="shareMeetingGameDues('${g.date}')">공유</button>
      </div>
      <div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>회원</th><th>청구</th><th>납부</th><th>게임비 잔액</th></tr></thead><tbody>
      ${people.sort((a,b)=>b.unpaid-a.unpaid||a.name.localeCompare(b.name,'ko')).map(x=>`<tr><td><b>${x.name}</b></td><td>${won(x.total)}</td><td class="money-in">${won(x.paid)}</td><td class="${x.unpaid>0?'money-out':''}"><b>${won(x.unpaid)}</b></td></tr>`).join('')||'<tr><td colspan="4" class="empty">내역 없음</td></tr>'}
      </tbody></table></div>
    </div>`;
  }).join('');
  $('duesByMeeting').innerHTML=meetingHtml||'<div class="empty">해당 월의 모임별 게임비 내역이 없습니다.</div>';

  const grouped={};
  monthRows.forEach(d=>{
    const m=members.find(x=>x.id===d.member_id);
    if(!grouped[d.member_id])grouped[d.member_id]={memberId:d.member_id,name:m?.name||'-',total:0,paid:0,unpaid:0,unpaidCount:0};
    const g=grouped[d.member_id];
    g.total+=Number(d.amount);
    if(d.status==='paid')g.paid+=Number(d.amount);
    else{g.unpaid+=Number(d.amount);g.unpaidCount++}
  });
  let rows=Object.values(grouped);
  if(status==='unpaid')rows=rows.filter(x=>x.unpaid>0);
  if(status==='paid')rows=rows.filter(x=>x.paid>0);
  const total=rows.reduce((s,x)=>s+x.total,0),unpaid=rows.reduce((s,x)=>s+x.unpaid,0),paid=rows.reduce((s,x)=>s+x.paid,0);
  const actualGameCount=new Set(monthRows.map(d=>{
    if(d.three_team_series_id)return 'T:'+d.three_team_series_id;
    if(d.series_id)return 'S:'+d.series_id;
    if(d.game_id)return 'G:'+d.game_id;
    return 'D:'+d.id;
  })).size;
  $('receivableKpis').innerHTML=[['청구액',won(total)],['게임비 잔액',won(unpaid)],['납부액',won(paid)],['게임 횟수',actualGameCount+'경기']].map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div></div>`).join('');
  $('duesBody').innerHTML=rows.sort((a,b)=>b.unpaid-a.unpaid||a.name.localeCompare(b.name,'ko')).map(x=>`<tr>
    <td><b>${x.name}</b></td><td>${won(x.total)}</td><td class="money-in">${won(x.paid)}</td>
    <td class="${x.unpaid>0?'money-out':''}"><b>${won(x.unpaid)}</b></td><td>${x.unpaidCount}건</td>
    <td><div class="row">${x.unpaid>0?`<button class="btn green small" onclick="markMemberDuesPaid('${x.memberId}','${month}')">합계 입금확인</button><button class="btn blue small" onclick="shareMemberGameDues('${x.memberId}')">공유</button>`:'<span class="badge" style="background:#dcfce7;color:#166534">완납</span>'}</div></td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty">내역 없음</td></tr>';
}
async function markMemberDuesPaid(memberId,month){
  const rows=gameDues.filter(d=>d.member_id===memberId&&d.status==='unpaid'&&monthKey(d.due_date)===month);
  const member=members.find(x=>x.id===memberId);
  const amount=rows.reduce((s,d)=>s+Number(d.amount),0);
  if(!rows.length)return toast('납부할 게임비가 없습니다.');
  if(!confirm(`${member?.name||'회원'}의 게임비 합계 ${won(amount)} 입금을 확인했나요?
확인 시 수입 내역 1건으로 합산 반영됩니다.`))return;
  const {error}=await sb.rpc('admin_mark_member_game_dues_paid',{p_member_id:memberId,p_month:month+'-01',p_paid_date:today()});
  if(error)return toast(error.message);
  toast('게임비 합계 입금 확인 / 수입 반영 완료');
  await loadAll()
}

function renderSystemManagement(){
  if(!$('carryFromYear'))return;
  const currentYear=new Date().getFullYear();
  if(!$('carryFromYear').value)$('carryFromYear').value=currentYear-1;
  const from=Number($('carryFromYear').value||currentYear-1);
  $('carryToYear').value=from+1;
  const start=from+'-01-01',end=(from+1)+'-01-01';
  const rows=transactions.filter(t=>t.tx_date>=start&&t.tx_date<end);
  const balance=rows.reduce((s,t)=>s+(t.tx_type==='income'?Number(t.amount):-Number(t.amount)),0);
  $('carryPreview').innerHTML=`${from}년 수입·지출 기준 잔액: <b>${won(balance)}</b><br>${from+1}년 1월 1일 이월잔액으로 등록`;
}
$('carryFromYear')?.addEventListener('input',renderSystemManagement);

async function carryYearBalance(){
  const from=Number($('carryFromYear').value);
  if(!from||from<2023||from>2100)return toast('마감 연도를 확인하세요.');
  renderSystemManagement();
  const start=from+'-01-01',end=(from+1)+'-01-01';
  const rows=transactions.filter(t=>t.tx_date>=start&&t.tx_date<end);
  const balance=rows.reduce((s,t)=>s+(t.tx_type==='income'?Number(t.amount):-Number(t.amount)),0);
  if(!confirm(`${from}년 말 잔액 ${won(balance)}을 ${from+1}년으로 이월할까요?`))return;
  const {data,error}=await sb.rpc('admin_carry_year_balance',{p_from_year:from});
  if(error)return toast('연도 이월 실패: '+error.message);
  toast(`${from+1}년 이월잔액 ${won(data?.balance||0)} 등록 완료`);
  await loadAll();
}

function openResetModal(){
  $('resetConfirmText').value='';
  $('resetPin').value='';
  openModal('resetModal');
}

async function executeReset(){
  const text=$('resetConfirmText').value.trim();
  const pin=$('resetPin').value.trim();
  if(text!=='초기화')return toast('확인 문구에 "초기화"를 입력하세요.');
  if(!/^\d{4}$/.test(pin))return toast('4자리 초기화 PIN을 입력하세요.');
  if(!confirm('정말 회원 명단을 제외한 모든 운영 데이터를 초기화할까요?\n이 작업은 복구할 수 없습니다.'))return;
  const {data,error}=await sb.rpc('admin_reset_operational_data',{p_pin:pin});
  if(error)return toast('초기화 실패: '+error.message);
  if(!data?.ok)return toast(data?.message||'초기화 PIN을 확인하세요.');
  closeModal('resetModal');
  toast('회원 명단을 제외한 운영 데이터 초기화 완료');
  await loadAll();
}

function currentDuesMonth(){return $('duesMonth')?.value||new Date().toISOString().slice(0,7)}
function unpaidRowsForMonth(){const month=currentDuesMonth();return gameDues.filter(d=>monthKey(d.due_date)===month&&d.status==='unpaid')}
function buildAllDuesShareText(rows=unpaidRowsForMonth(),title='게임비 안내'){
  const byDate={};
  rows.forEach(d=>{
    const date=d.due_date;
    const m=members.find(x=>x.id===d.member_id);
    const name=m?.name||'-';
    if(!byDate[date])byDate[date]={};
    if(!byDate[date][name])byDate[date][name]=0;
    byDate[date][name]+=Number(d.amount);
  });

  const sections=Object.entries(byDate)
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([date,people])=>{
      const lines=Object.entries(people)
        .sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0],'ko'))
        .map(([name,amount])=>`• ${name} : ${won(amount)}`)
        .join('\n');
      return `📅 ${date} 모임\n${lines}`;
    });

  const total=rows.reduce((s,d)=>s+Number(d.amount),0);
  return `⚽ 올인 족구단 ${title}\n\n${sections.join('\n\n')}\n\n총 게임비 : ${won(total)}\n입금 완료 후 총무에게 알려주세요.`;
}
function buildMemberDuesShareText(memberId){
  const month=currentDuesMonth();
  const m=members.find(x=>x.id===memberId);
  const rows=gameDues.filter(d=>d.member_id===memberId&&d.status==='unpaid'&&monthKey(d.due_date)===month);
  const byDate={};
  rows.forEach(d=>{byDate[d.due_date]=(byDate[d.due_date]||0)+Number(d.amount)});
  const total=rows.reduce((s,d)=>s+Number(d.amount),0);
  return `⚽ 올인 족구단 게임비 안내\n${m?.name||'회원'}님\n\n${Object.entries(byDate).sort().map(([date,amount])=>`📅 ${date} 모임 : ${won(amount)}`).join('\n')}\n\n입금하실 게임비 합계 : ${won(total)}\n입금 완료 후 총무에게 알려주세요.`;
}
async function shareText(text,title='올인 족구단 게임비'){
  if(navigator.share){
    try{await navigator.share({title,text});return}catch(e){if(e.name==='AbortError')return}
  }
  await navigator.clipboard.writeText(text);
  toast('공유문구를 복사했습니다. 카카오톡 단톡방에 붙여넣으세요.');
}
function shareAllGameDues(){const rows=unpaidRowsForMonth();if(!rows.length)return toast('공유할 게임비 내역이 없습니다.');shareText(buildAllDuesShareText(rows))}
async function copyAllGameDues(){
  const rows=unpaidRowsForMonth();if(!rows.length)return toast('복사할 게임비 내역이 없습니다.');
  await navigator.clipboard.writeText(buildAllDuesShareText(rows));toast('게임비 안내 문구 복사 완료');
}
function shareMeetingGameDues(date){
  const rows=unpaidRowsForMonth().filter(d=>d.due_date===date);
  if(!rows.length)return toast('해당 모임일의 게임비 내역이 없습니다.');
  shareText(buildAllDuesShareText(rows,'게임비 안내'));
}
function shareMemberGameDues(memberId){
  const text=buildMemberDuesShareText(memberId);
  shareText(text,'개인 게임비 안내');
}
