let members=[], meetings=[], attendance=[], teams=[], teamMembers=[], transactions=[], fees=[], games=[], gameDues=[], matchSeries=[], seriesSets=[], settings={monthly_fee:20000};
const openModal=id=>$(id).classList.add('show'),closeModal=id=>$(id).classList.remove('show');
async function init(){
  if(!requireConfig())return;
  const {data:{session}}=await sb.auth.getSession();
  if(session) await enterApp(); else {$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}
  sb.auth.onAuthStateChange((_e,s)=>{if(!s){$('loginView').classList.remove('hidden');$('appView').classList.add('hidden')}});
}
async function login(){
 if(!requireConfig())return;
 if($('email').value.trim()!=='admin'||$('password').value!=='1111')return toast('아이디 또는 비밀번호가 올바르지 않습니다.');
 const {error}=await sb.auth.signInWithPassword({email:'admin@allin.club',password:'1111'});
 if(error)return toast('Supabase 관리자 계정 설정이 필요합니다. README를 확인하세요.');
 await enterApp();
}
async function logout(){await sb.auth.signOut();location.reload()}
async function enterApp(){
  const {data,error}=await sb.rpc('is_admin');if(error||!data){await sb.auth.signOut();return toast('관리자 권한이 없습니다.')}
  $('loginView').classList.add('hidden');$('appView').classList.remove('hidden');await loadAll();subscribeRealtime();
}
async function loadAll(){
  const queries=await Promise.all([
    sb.from('members').select('*').order('name'),
    sb.from('meetings').select('*').order('meeting_date',{ascending:false}),
    sb.from('attendance').select('*'),
    sb.from('teams').select('*'),
    sb.from('team_members').select('*'),
    sb.from('transactions').select('*').order('tx_date',{ascending:false}),
    sb.from('fees').select('*'),
    sb.from('games').select('*'),
    sb.from('game_dues').select('*').order('due_date',{ascending:false}),
    sb.from('match_series').select('*').order('created_at',{ascending:false}),
    sb.from('series_sets').select('*').order('set_no',{ascending:true}),
    sb.from('club_settings').select('*').eq('id',1).maybeSingle()
  ]);
  if(queries.some(q=>q.error)){console.error(queries.map(q=>q.error));return toast('데이터 로드 오류')}
  [members,meetings,attendance,teams,teamMembers,transactions,fees,games,gameDues,matchSeries,seriesSets]=queries.slice(0,11).map(q=>q.data||[]);
  settings=queries[11].data||{id:1,monthly_fee:20000};
  renderAll();
}
let rtStarted=false;
function subscribeRealtime(){
  if(rtStarted)return;rtStarted=true;
  sb.channel('admin-live').on('postgres_changes',{event:'*',schema:'public',table:'attendance'},()=>loadAll()).on('postgres_changes',{event:'*',schema:'public',table:'transactions'},()=>loadAll()).subscribe();
}
function go(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav').forEach(v=>v.classList.toggle('active',v.dataset.view===id));renderAll();scrollTo({top:0,behavior:'smooth'})}
function renderAll(){renderSelects();renderDashboard();renderMembers();renderFinance();renderAttendance();renderGames();renderMatchday();renderReceivables()}
function period(offset=0){const d=new Date();d.setMonth(d.getMonth()+offset);const key=d.toISOString().slice(0,7),rows=transactions.filter(t=>monthKey(t.tx_date)===key);return{key,income:rows.filter(t=>t.tx_type==='income').reduce((s,t)=>s+Number(t.amount),0),expense:rows.filter(t=>t.tx_type==='expense').reduce((s,t)=>s+Number(t.amount),0)}}
function renderDashboard(){
  const cur=period(),prev=period(-1),bal=transactions.reduce((s,t)=>s+(t.tx_type==='income'?Number(t.amount):-Number(t.amount)),0),next=meetings.filter(m=>m.meeting_date>=today()).sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date))[0];
  $('kpis').innerHTML=[['현재 잔액',won(bal),'누적 수입 - 지출'],['당월 수입',won(cur.income),`전월 ${won(prev.income)}`],['당월 지출',won(cur.expense),`전월 ${won(prev.expense)}`],['회원 수',members.length+'명',POSITIONS.map(p=>p+' '+members.filter(m=>m.position===p).length).join(' · ')]].map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div><div class="sub">${x[2]}</div></div>`).join('');
  $('nextMeetingDate').textContent=next?.meeting_date||'-';const ids=attendance.filter(a=>a.meeting_id===next?.id&&a.attending).map(a=>a.member_id),people=members.filter(m=>ids.includes(m.id));
  $('meetingSummary').innerHTML=next?`<div style="font-size:28px;font-weight:850">${people.length}명 참석 예정</div><div class="row" style="margin-top:10px">${POSITIONS.map(p=>`${badge(p)} <b>${people.filter(x=>x.position===p).length}</b>`).join('')}</div><button class="btn dark" style="width:100%;margin-top:14px" onclick="go('attendance')">참석 현황 보기</button>`:'<div class="empty">예정된 모임이 없습니다.</div>';
  $('recentTx').innerHTML=transactions.slice(0,6).map(t=>`<div class="row" style="justify-content:space-between;padding:8px 0;border-bottom:1px solid #e5e7eb"><span>${t.tx_date} · ${t.category}</span><b class="${t.tx_type==='income'?'money-in':'money-out'}">${t.tx_type==='income'?'+':'-'} ${won(t.amount)}</b></div>`).join('')||'<div class="empty">내역 없음</div>';
}
function openMember(id){
  const m=members.find(x=>x.id===id);$('memberTitle').textContent=m?'회원 수정':'회원 추가';$('memberId').value=m?.id||'';$('memberName').value=m?.name||'';$('memberBirthYear').value=m?.birth_year||'';$('memberPhone').value=m?.phone||'';$('memberPosition').value=m?.position||'공격';$('memberPin').value='';$('memberPin').placeholder=m?'변경할 때만 새 PIN 입력':'4자리 숫자';openModal('memberModal')
}
async function saveMember(){
  const id=$('memberId').value,name=$('memberName').value.trim(),pin=$('memberPin').value.trim();if(!name)return toast('이름을 입력하세요.');if((!id&&!/^\d{4}$/.test(pin))||(pin&&!/^\d{4}$/.test(pin)))return toast('PIN은 4자리 숫자입니다.');
  const payload={name,birth_year:Number($('memberBirthYear').value)||null,phone:$('memberPhone').value.trim()||null,position:$('memberPosition').value};
  let q=id?sb.from('members').update(payload).eq('id',id):sb.rpc('admin_create_member_v40',{p_name:name,p_birth_year:payload.birth_year,p_phone:payload.phone,p_position:payload.position,p_pin:pin});
  let {data,error}=await q;if(error)return toast(error.message);
  if(id&&pin){const r=await sb.rpc('admin_set_member_pin',{p_member_id:id,p_pin:pin});if(r.error)return toast(r.error.message)}
  closeModal('memberModal');toast('회원 저장 완료');await loadAll();
}
async function deleteMember(id){if(!confirm('회원을 삭제할까요?'))return;const {error}=await sb.from('members').delete().eq('id',id);if(error)return toast(error.message);await loadAll()}
function renderMembers(){
  const q=$('memberSearchAdmin')?.value.trim()||'',p=$('posFilter')?.value||'';const rows=members.filter(m=>(!q||(m.name+(m.phone||'')).includes(q))&&(!p||m.position===p));
  $('memberBody').innerHTML=rows.map(m=>`<tr><td><b>${m.name}</b></td><td>${m.birth_year||'-'}</td><td>${m.phone||'-'}</td><td>${badge(m.position)}</td><td>••••</td><td><button class="btn small" onclick="openMember('${m.id}')">수정</button> <button class="btn red small" onclick="deleteMember('${m.id}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="6" class="empty">회원 없음</td></tr>';
}
function renderFinance(){
  if(!$('feeMonth').value)$('feeMonth').value=new Date().toISOString().slice(0,7);if(!$('txMonth').value)$('txMonth').value=new Date().toISOString().slice(0,7);$('feeAmount').value=settings.monthly_fee;
  const cur=period(),prev=period(-1);$('financeKpis').innerHTML=[['전월 수입',won(prev.income)],['전월 지출',won(prev.expense)],['당월 수입',won(cur.income)],['당월 지출',won(cur.expense)]].map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div></div>`).join('');renderFees();renderTx();
}
async function saveFeeAmount(){const amount=Number($('feeAmount').value)||0;const {error}=await sb.from('club_settings').upsert({id:1,monthly_fee:amount});if(error)return toast(error.message);settings.monthly_fee=amount;toast('월 회비 저장');renderFees()}
function renderFees(){
  const month=$('feeMonth').value;$('feeBody').innerHTML=members.map(m=>{const f=fees.find(x=>x.member_id===m.id&&x.fee_month===month);return`<tr><td><b>${m.name}</b></td><td>${badge(m.position)}</td><td>${won(settings.monthly_fee)}</td><td>${f?.paid?'<span class="badge" style="background:#dcfce7;color:#166534">납부</span>':'<span class="badge">미납</span>'}</td><td>${f?.paid_date||'-'}</td><td>${f?.paid?`<button class="btn red small" onclick="setFee('${m.id}','${month}',false)">취소</button>`:`<button class="btn green small" onclick="setFee('${m.id}','${month}',true)">납부</button>`}</td></tr>`}).join('');
}
async function setFee(memberId,month,paid){const {data,error}=await sb.rpc('admin_set_fee',{p_member_id:memberId,p_month:month+'-01',p_paid:paid});if(error)return toast(error.message);toast(paid?'납부 처리 완료':'납부 취소');await loadAll()}
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
  const active=matchSeries.find(s=>s.meeting_id===m.id&&s.status==='active');
  if(active)return toast('진행 중인 시리즈를 먼저 종료하세요.');
  const rpc=mode==='random'?'admin_generate_random_teams_v42':'admin_generate_balanced_teams_v42';
  const {data,error}=await sb.rpc(rpc,{p_meeting_id:m.id});
  if(error)return toast(error.message);
  toast(`${mode==='random'?'완전 랜덤':'포지션 균형'} 팀 ${data?.team_count||0}개 생성`);
  await loadAll()
}
function renderTeams(){
  const m=currentMeeting();if(!m)return;const ts=teams.filter(t=>t.meeting_id===m.id).sort((a,b)=>a.team_no-b.team_no);const used=teamMembers.filter(tm=>ts.some(t=>t.id===tm.team_id)).map(tm=>tm.member_id),waiting=attendingPeople(m).filter(x=>!used.includes(x.id));
  $('teamArea').innerHTML=ts.length?`<div class="team-grid">${ts.map(t=>`<div class="team-card"><h3>${t.team_name}</h3>${teamMembers.filter(tm=>tm.team_id===t.id).map(tm=>members.find(x=>x.id===tm.member_id)).filter(Boolean).map(x=>`<div class="team-member"><b>${x.name}</b>${badge(x.position)}</div>`).join('')}</div>`).join('')}</div>${waiting.length?`<div class="notice" style="margin-top:12px"><b>대기:</b> ${waiting.map(x=>`${x.name}(${x.position})`).join(', ')}</div>`:''}`:'<div class="empty">팀을 생성해 주세요.</div>';
}
async function addGame(){
  const m=currentMeeting('gameMeetingSelect'),ts=teams.filter(t=>t.meeting_id===m?.id).sort((a,b)=>a.team_no-b.team_no);
  if(ts.length<2)return toast('먼저 2개 이상의 팀을 생성하세요.');
  const {error}=await sb.from('games').insert({meeting_id:m.id,team_a:ts[0].id,team_b:ts[1].id});
  if(error)return toast(error.message);await loadAll()
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
    <div class="row"><button class="btn blue small" onclick="openScore('${g.id}')">점수</button>${g.winner_team_id?`<button class="btn small" onclick="clearGameResult('${g.id}')">결과취소</button>`:''}<button class="btn red small" onclick="deleteGame('${g.id}')">삭제</button></div>
  </div>`).join('')||'<div class="empty">경기 없음</div>';
  const dues=gameDues.filter(d=>d.meeting_id===m.id),paid=dues.filter(d=>d.status==='paid'),unpaid=dues.filter(d=>d.status==='unpaid');
  $('gameFeeSummary').innerHTML=dues.length?`<div class="grid g4">
    <div class="kpi"><div class="label">총 청구</div><div class="value">${won(dues.reduce((s,d)=>s+Number(d.amount),0))}</div></div>
    <div class="kpi"><div class="label">미납</div><div class="value">${won(unpaid.reduce((s,d)=>s+Number(d.amount),0))}</div></div>
    <div class="kpi"><div class="label">납부</div><div class="value">${won(paid.reduce((s,d)=>s+Number(d.amount),0))}</div></div>
    <div class="kpi"><div class="label">청구 건수</div><div class="value">${dues.length}건</div></div>
  </div>`:'<div class="empty">점수를 저장하면 일반 패배는 2,000원, 8점 차 이상 콜드게임 패배는 4,000원 청구가 생성됩니다. 실제 입금 전에는 수입에 반영되지 않습니다.</div>';
}
init();


function matchMeeting(){return meetings.find(m=>m.id===$('matchMeetingSelect')?.value)||meetings[0]}
function prepareMatchday(){loadAll();toast('운영 화면을 새로고침했습니다.')}
function seriesForMeeting(m){return matchSeries.filter(s=>s.meeting_id===m?.id)}
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
  const completed=allSeries.filter(s=>s.status==='completed');

  $('matchdaySummary').innerHTML=`<div class="grid g4">
    <div class="kpi"><div class="label">모임일</div><div class="value">${m.meeting_date}</div></div>
    <div class="kpi"><div class="label">참석자</div><div class="value">${people.length}명</div></div>
    <div class="kpi"><div class="label">현재 팀</div><div class="value">${ts.length}팀</div></div>
    <div class="kpi"><div class="label">완료 시리즈</div><div class="value">${completed.length}회</div></div>
  </div>
  <div class="row" style="margin-top:12px">${POSITIONS.map(p=>`${badge(p)} <b>${people.filter(x=>x.position===p).length}명</b>`).join('')}</div>`;

  $('teamGenerationStatus').textContent=active?'시리즈 진행 중 · 재편성 잠금':'팀 편성 가능';
  $('matchdayTeams').innerHTML=ts.length?`<div class="team-grid">${ts.map(t=>`<div class="team-card">
    <h3>${t.team_name}</h3>
    ${teamMembers.filter(tm=>tm.team_id===t.id).map(tm=>members.find(x=>x.id===tm.member_id)).filter(Boolean).map(x=>`<div class="team-member"><b>${x.name}</b>${badge(x.position)}</div>`).join('')}
  </div>`).join('')}</div>`:'<div class="empty">참석자를 확인하고 팀을 편성하세요.</div>';

  if(active){
    $('seriesStartArea').innerHTML=`<div class="notice"><b>${active.series_no}차 시리즈 진행 중</b><br>${active.team_a_name} vs ${active.team_b_name} · ${active.best_of===3?'3판 2승제':'5판 3승제'}</div>`;
  }else if(ts.length>=2){
    $('seriesStartArea').innerHTML=`<div class="form-grid">
      <div class="field"><label>A팀</label><select id="seriesTeamA">${ts.map(t=>`<option value="${t.id}">${t.team_name}</option>`).join('')}</select></div>
      <div class="field"><label>B팀</label><select id="seriesTeamB">${ts.map((t,i)=>`<option value="${t.id}" ${i===1?'selected':''}>${t.team_name}</option>`).join('')}</select></div>
      <div class="field"><label>경기 방식</label><select id="seriesBestOf"><option value="3">3판 2승제</option><option value="5">5판 3승제</option></select></div>
    </div><button class="btn dark" style="width:100%;margin-top:12px" onclick="startSeries()">시리즈 시작</button>`;
  }else{
    $('seriesStartArea').innerHTML='<div class="empty">2개 이상의 팀을 먼저 편성하세요.</div>';
  }

  renderSeriesArea(m,active);
  renderSeriesHistory(m);
}
async function startSeries(){
  const m=matchMeeting();
  const teamA=$('seriesTeamA')?.value,teamB=$('seriesTeamB')?.value,bestOf=Number($('seriesBestOf')?.value||3);
  if(!teamA||!teamB||teamA===teamB)return toast('서로 다른 두 팀을 선택하세요.');
  const {data,error}=await sb.rpc('admin_start_match_series',{
    p_meeting_id:m.id,p_team_a_id:teamA,p_team_b_id:teamB,p_best_of:bestOf
  });
  if(error)return toast(error.message);
  toast(`${bestOf===3?'3판 2승제':'5판 3승제'} 시리즈 시작`);
  await loadAll()
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
  $('seriesHistory').innerHTML=rows.length?rows.map(s=>{
    const sets=seriesSets.filter(x=>x.series_id===s.id).sort((a,b)=>a.set_no-b.set_no);
    return `<div style="padding:12px 0;border-bottom:1px solid #e5e7eb">
      <div class="row" style="justify-content:space-between"><div><b>${s.series_no}차 · ${s.team_a_name} ${s.team_a_wins}:${s.team_b_wins} ${s.team_b_name}</b>
      <div style="font-size:12px;color:#6b7280;margin-top:4px">${s.best_of===3?'3판 2승제':'5판 3승제'} · 승리 ${s.winner_name} · 패배 ${s.loser_name}</div></div>
      <span class="badge ${s.fee_amount===4000?'attack':''}">${s.fee_amount===4000?'8:0 콜드 적용 ':''}${won(s.fee_amount)}/인</span></div>
      <div class="row" style="margin-top:8px">${sets.map(x=>`<span class="badge">${x.set_no}세트 ${x.score_a}:${x.score_b}${x.cold_game?' · 콜드':''}</span>`).join('')}</div>
    </div>`;
  }).join(''):'<div class="empty">종료된 시리즈가 없습니다.</div>';
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
  $('receivableKpis').innerHTML=[['청구액',won(total)],['미납액',won(unpaid)],['납부액',won(paid)],['미납 건수',rows.reduce((s,x)=>s+x.unpaidCount,0)+'건']].map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div></div>`).join('');
  $('duesBody').innerHTML=rows.sort((a,b)=>b.unpaid-a.unpaid||a.name.localeCompare(b.name,'ko')).map(x=>`<tr>
    <td><b>${x.name}</b></td><td>${won(x.total)}</td><td class="money-in">${won(x.paid)}</td>
    <td class="${x.unpaid>0?'money-out':''}"><b>${won(x.unpaid)}</b></td><td>${x.unpaidCount}건</td>
    <td>${x.unpaid>0?`<button class="btn green small" onclick="markMemberDuesPaid('${x.memberId}','${month}')">합계 입금확인</button>`:'<span class="badge" style="background:#dcfce7;color:#166534">완납</span>'}</td>
  </tr>`).join('')||'<tr><td colspan="6" class="empty">내역 없음</td></tr>';
}
async function markMemberDuesPaid(memberId,month){
  const rows=gameDues.filter(d=>d.member_id===memberId&&d.status==='unpaid'&&monthKey(d.due_date)===month);
  const member=members.find(x=>x.id===memberId);
  const amount=rows.reduce((s,d)=>s+Number(d.amount),0);
  if(!rows.length)return toast('미납 게임비가 없습니다.');
  if(!confirm(`${member?.name||'회원'}의 미납 게임비 합계 ${won(amount)} 입금을 확인했나요?
확인 시 수입 내역 1건으로 합산 반영됩니다.`))return;
  const {error}=await sb.rpc('admin_mark_member_game_dues_paid',{p_member_id:memberId,p_month:month+'-01',p_paid_date:today()});
  if(error)return toast(error.message);
  toast('게임비 합계 입금 확인 / 수입 반영 완료');
  await loadAll()
}
