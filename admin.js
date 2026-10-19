
async function purgeOldAdminCachesV573(){
  try{
    const key='allin_admin_cache_purged_v573';
    if(localStorage.getItem(key))return;
    if('caches' in window){
      const names=await caches.keys();
      await Promise.all(names.filter(n=>n!=='allin-v5.7.3').map(n=>caches.delete(n)));
    }
    localStorage.setItem(key,'1');
  }catch(e){
    console.warn('cache purge skipped',e);
  }
}

let members=[], meetings=[], attendance=[], teams=[], teamMembers=[], transactions=[], fees=[], feePayments=[], games=[], gameDues=[], gameFeeAdjustments=[], matchSeries=[], seriesSets=[], seriesTeamSnapshots=[], threeTeamSeries=[], threeTeamGames=[], threeTeamFeatureReady=true, settings={monthly_fee:20000};
const openModal=id=>$(id).classList.add('show'),closeModal=id=>$(id).classList.remove('show');
async function init(){
  await purgeOldAdminCachesV573();
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

let allinLoadQueue=Promise.resolve();
function loadAll(){
  const next=allinLoadQueue.then(loadAllData,loadAllData);
  allinLoadQueue=next.catch(()=>{});return next;
}
async function loadAllData(){
  // 기존 운영 데이터는 3팀 확장 기능과 분리해서 먼저 읽는다.
  // 확장 테이블이 아직 없더라도 회원/모임/게임비 화면은 계속 정상 표시되어야 한다.
  const coreQueries=await Promise.all([
    sb.from('members').select('*').order('name'),
    sb.from('meetings').select('*').order('meeting_date',{ascending:false}),
    sb.from('attendance').select('*'),
    sb.from('teams').select('*'),
    sb.from('team_members').select('*'),
    Promise.resolve({data:[],error:null}),
    Promise.resolve({data:[],error:null}),
    Promise.resolve({data:[],error:null}),
    sb.from('games').select('*'),
    sb.from('game_dues').select('*').is('deleted_at',null).order('due_date',{ascending:false}),
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
    sb.from('three_team_games').select('*').order('game_no',{ascending:true}),
    sb.from('member_game_fee_adjustments').select('*').order('created_at',{ascending:false}),
    sb.from('series_team_snapshots').select('*').order('created_at',{ascending:false})
  ]);

  const optionalError=optionalQueries.slice(0,2).map(q=>q?.error).find(Boolean);
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
  gameFeeAdjustments=optionalQueries[2]?.error?[]:(optionalQueries[2].data||[]);
  seriesTeamSnapshots=optionalQueries[3]?.error?[]:(optionalQueries[3].data||[]);

  renderAll();
}
let rtStarted=false;
function subscribeRealtime(){
  if(rtStarted)return;rtStarted=true;
  let busy=false,pending=false,timer;
  const refresh=async()=>{
    if(document.hidden)return;
    if(busy){pending=true;return;}
    busy=true;
    try{do{pending=false;await loadAll();}while(pending&&!document.hidden);}
    catch(error){console.error('ALLIN sync',error);}
    finally{busy=false;}
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(refresh,350);};
  let channel=sb.channel('allin-live');
  for(const table of ['members','meetings','attendance','teams','team_members','match_series','series_sets','three_team_series','three_team_games','series_team_snapshots','game_dues','member_game_fee_adjustments','club_settings']){
    channel=channel.on('postgres_changes',{event:'*',schema:'public',table},schedule);
  }
  channel.subscribe(status=>{if(status==='SUBSCRIBED')schedule();});
  // PIN 운영 화면은 RLS로 이벤트를 받지 못할 수도 있으므로 서버를 주기적으로 다시 읽는다.
  setInterval(refresh,10000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule();});
  window.addEventListener('online',schedule);
  window.addEventListener('focus',schedule);
}
function go(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('.nav').forEach(v=>v.classList.toggle('active',v.dataset.view===id));renderAll();scrollTo({top:0,behavior:'smooth'})}
function renderAll(){renderSelects();renderDashboard();renderMembers();renderAttendance();renderGames();renderMatchday();renderReceivables()}
function period(offset=0){const d=new Date();d.setMonth(d.getMonth()+offset);const key=d.toISOString().slice(0,7),rows=transactions.filter(t=>monthKey(t.tx_date)===key);return{key,income:rows.filter(t=>t.tx_type==='income').reduce((s,t)=>s+Number(t.amount),0),expense:rows.filter(t=>t.tx_type==='expense').reduce((s,t)=>s+Number(t.amount),0)}}
function renderDashboard(){
 const month=currentDuesMonth(),rows=visibleGameFeeRows(month),deltas=gameFeeAdjustments.filter(a=>monthKey(a.adjustment_month)===month).reduce((n,a)=>n+Number(a.charge_delta||0),0);
 $('kpis').innerHTML=[['당월 게임비',won(rows.reduce((n,d)=>n+Number(d.amount),0)+deltas)],['당월 경기',new Set(rows.map(gameDueSeriesKey)).size+'경기'],['회원 수',members.length+'명'],['당월 대상',new Set(rows.map(d=>d.member_id)).size+'명']].map(x=>'<div class="card kpi"><div class="label">'+x[0]+'</div><div class="value">'+x[1]+'</div></div>').join('');
 const next=meetings.filter(m=>m.meeting_date>=today()).sort((a,b)=>a.meeting_date.localeCompare(b.meeting_date))[0];
 $('nextMeetingDate').textContent=next?.meeting_date||'-';
 const ids=attendance.filter(a=>a.meeting_id===next?.id&&a.attending).map(a=>a.member_id),people=members.filter(m=>ids.includes(m.id));
 $('meetingSummary').innerHTML=next?'<b>'+people.length+'명 참석 예정</b><div class="row" style="margin-top:10px">'+POSITIONS.map(p=>badge(p)+' '+people.filter(m=>m.position===p).length+'명').join(' · ')+'</div>':'<div class="empty">예정된 모임이 없습니다.</div>';
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
  const m=members.find(x=>x.id===id);$('memberTitle').textContent=m?'회원 수정':'회원 추가';$('memberId').value=m?.id||'';$('memberName').value=m?.name||'';$('memberBirthYear').value=m?.birth_year||'';$('memberPhone').value=m?.phone||'';$('memberPosition').value=m?.position||'공격';$('memberSkillLevel').value=String(m?.skill_level||3);syncSecondaryPositions(m?.secondary_positions||[]);$('memberPin').value='';$('memberPin').placeholder=m?'변경할 때만 새 PIN 입력':'4자리 숫자';openModal('memberModal')
}
async function saveMember(){
  const id=$('memberId').value,name=$('memberName').value.trim(),pin=$('memberPin').value.trim();if(!name)return toast('이름을 입력하세요.');if((!id&&!/^\d{4}$/.test(pin))||(pin&&!/^\d{4}$/.test(pin)))return toast('PIN은 4자리 숫자입니다.');
  const payload={name,birth_year:Number($('memberBirthYear').value)||null,phone:$('memberPhone').value.trim()||null,position:$('memberPosition').value,secondary_positions:selectedSecondaryPositions(),skill_level:Number($('memberSkillLevel').value)||3};
  let data,error;
  if(id){({data,error}=await sb.from('members').update(payload).eq('id',id));}
  else{
    ({data,error}=await sb.rpc('admin_create_member_v40',{p_name:name,p_birth_year:payload.birth_year,p_phone:payload.phone,p_position:payload.position,p_pin:pin}));
    if(!error){const r=await sb.from('members').update({secondary_positions:payload.secondary_positions,skill_level:payload.skill_level}).eq('id',data);if(r.error)error=r.error;}
  }
  if(error)return toast(error.message);
  if(id&&pin){const r=await sb.rpc('admin_set_member_pin',{p_member_id:id,p_pin:pin});if(r.error)return toast(r.error.message)}
  closeModal('memberModal');toast('회원 저장 완료');await loadAll();
}
async function deleteMember(id){if(!confirm('회원을 삭제할까요?'))return;const {error}=await sb.from('members').delete().eq('id',id);if(error)return toast(error.message);await loadAll()}
function renderMembers(){
  const q=$('memberSearchAdmin')?.value.trim()||'',p=$('posFilter')?.value||'';
  const rows=members
    .filter(m=>(!q||(m.name+(m.phone||'')).includes(q))&&(!p||m.position===p))
    .sort((a,b)=>(POSITIONS.indexOf(a.position)-POSITIONS.indexOf(b.position))||a.name.localeCompare(b.name,'ko'));
  $('memberBody').innerHTML=rows.map(m=>`<tr><td><b>${m.name}</b></td><td>${m.birth_year||'-'}</td><td>${m.phone||'-'}</td><td>${badge(m.position)}</td><td>${secondaryPositionBadges(m)}</td><td><b>${m.skill_level||3}</b></td><td>••••</td><td><button class="btn small" onclick="openMember('${m.id}')">수정</button> <button class="btn red small" onclick="deleteMember('${m.id}')">삭제</button></td></tr>`).join('')||'<tr><td colspan="8" class="empty">회원 없음</td></tr>';
}

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
function openAttendance(){
  const m=currentMeeting();
  if(!m)return;

  $('attendanceChecks').innerHTML=members.map(x=>{
    const response=attendance.find(a=>a.meeting_id===m.id&&a.member_id===x.id);
    const state=response?response.attending===true?'attending':'absent':'pending';

    return `<div class="attendance-edit-row" data-member-id="${x.id}" data-state="${state}">
      <div class="attendance-edit-member"><b>${x.name}</b>${badge(x.position)}</div>
      <div class="attendance-state-buttons">
        <button type="button" class="attendance-state-btn attending ${state==='attending'?'selected':''}" onclick="setAttendanceEditState(this,'attending')">참석</button>
        <button type="button" class="attendance-state-btn absent ${state==='absent'?'selected':''}" onclick="setAttendanceEditState(this,'absent')">불참</button>
        <button type="button" class="attendance-state-btn pending ${state==='pending'?'selected':''}" onclick="setAttendanceEditState(this,'pending')">미응답</button>
      </div>
    </div>`;
  }).join('');

  openModal('attendanceModal');
}

function setAttendanceEditState(button,state){
  const row=button.closest('.attendance-edit-row');
  if(!row)return;
  row.dataset.state=state;
  row.querySelectorAll('.attendance-state-btn').forEach(btn=>btn.classList.remove('selected'));
  button.classList.add('selected');
}
async function saveAttendance(){
  const m=currentMeeting();
  if(!m)return;

  const rows=[...$('attendanceChecks').querySelectorAll('.attendance-edit-row')];
  const attendingIds=rows.filter(row=>row.dataset.state==='attending').map(row=>row.dataset.memberId);
  const absentIds=rows.filter(row=>row.dataset.state==='absent').map(row=>row.dataset.memberId);

  const {error}=await sb.rpc('admin_replace_attendance_v576',{
    p_meeting_id:m.id,
    p_attending_member_ids:attendingIds,
    p_absent_member_ids:absentIds
  });

  if(error)return toast(error.message);
  closeModal('attendanceModal');
  toast(`참석 ${attendingIds.length}명 · 불참 ${absentIds.length}명으로 저장했습니다.`);
  await loadAll();
}
async function generateTeams(mode='balanced',button=null){
  const m=currentMeeting();if(!m)return;
  const active=matchSeries.find(s=>s.meeting_id===m.id&&s.status==='active')||threeTeamSeries.find(s=>s.meeting_id===m.id&&s.status==='active');
  if(active)return toast('진행 중인 시리즈를 먼저 종료하세요.');
  const selected=button?.closest('.card')?.querySelector('.team-count-select')?.value||'';
  const teamCount=selected?Number(selected):null;
  const includeWaiting=button?.closest('.card')?.querySelector('.team-include-waiting')?.checked??true;
  const available=teamGenerationEligibleCount(m.id,includeWaiting);
  const requiredTeams=teamCount??(available>=16?4:available>=12?3:2);
  if(![2,3,4].includes(requiredTeams))return toast('팀 수를 확인하세요.');
  if(available<requiredTeams*4)return toast(requiredTeams+'팀은 팀당 4명씩 총 '+requiredTeams*4+'명이 필요합니다. 현재 편성 대상은 '+available+'명입니다. 대기자도 포함 옵션과 참석 여부를 확인하세요.');
  const rpc=mode==='random'?'admin_generate_random_teams_v5910':'admin_generate_balanced_teams_v5910';
  const {data,error}=await sb.rpc(rpc,{p_meeting_id:m.id,p_team_count:teamCount,p_include_waiting:includeWaiting});
  if(error)return toast(error.message);
  toast(`${mode==='random'?'완전 랜덤':`포지션·실력 균형(실력합 차이 ${data?.skill_gap??0})`} 팀 ${data?.team_count||0}개 생성 · 대기 ${data?.excluded_count||0}명 · 팀당 4명`);
  await loadAll()
}
function teamMemberRow(x,currentTeamId,ts,locked=false){
  const options=`<option value="" ${!currentTeamId?'selected':''}>대기</option>`+
    ts.map(t=>`<option value="${t.id}" ${t.id===currentTeamId?'selected':''}>${t.team_name}</option>`).join('');
  return `<div class="team-member team-member-manage"><div><b>${x.name}</b> ${badge(x.position)}</div><select class="team-assign-select" ${locked?'disabled':''} onchange="changeMemberTeam('${x.id}',this.value)">${options}</select></div>`;
}
async function changeMemberTeam(memberId,teamId){
  const m=currentMeeting();if(!m)return;
  const active=matchSeries.find(s=>s.meeting_id===m.id&&s.status==='active')||threeTeamSeries.find(s=>s.meeting_id===m.id&&s.status==='active');
  if(active)return toast('진행 중인 시리즈에서는 팀 또는 대기 상태를 변경할 수 없습니다.');
  const {error}=await sb.rpc('admin_assign_member_team_v51',{p_meeting_id:m.id,p_member_id:memberId,p_team_id:teamId||null});
  if(error)return toast(error.message);
  toast(teamId?'팀 배정을 변경했습니다.':'대기 상태로 변경했습니다.');await loadAll();
}
function renderTeams(){
  const m=currentMeeting();if(!m)return;
  const ts=teams.filter(t=>t.meeting_id===m.id).sort((a,b)=>a.team_no-b.team_no);
  const active=matchSeries.find(s=>s.meeting_id===m.id&&s.status==='active')||threeTeamSeries.find(s=>s.meeting_id===m.id&&s.status==='active');
  const attending=attendingPeople(m);
  const used=teamMembers.filter(tm=>ts.some(t=>t.id===tm.team_id)).map(tm=>tm.member_id);
  const waiting=attending.filter(x=>!used.includes(x.id));
  if(!ts.length){$('teamArea').innerHTML='<div class="empty">팀을 생성해 주세요.</div>';return;}
  const cards=ts.map(t=>`<div class="team-card"><h3>${t.team_name} <small>${teamMembers.filter(tm=>tm.team_id===t.id).length}명</small></h3>${teamMembers.filter(tm=>tm.team_id===t.id).map(tm=>members.find(x=>x.id===tm.member_id)).filter(Boolean).map(x=>teamMemberRow(x,t.id,ts,!!active)).join('')||'<div class="empty compact">배정된 회원 없음</div>'}</div>`).join('');
  const waitingCard=`<div class="team-card waiting-card"><h3>대기 <small>${waiting.length}명</small></h3>${waiting.map(x=>teamMemberRow(x,null,ts,!!active)).join('')||'<div class="empty compact">대기 인원 없음</div>'}</div>`;
  $('teamArea').innerHTML=`<div class="team-summary">${ts.map(t=>`<span class="badge">${t.team_name} ${teamMembers.filter(tm=>tm.team_id===t.id).length}명</span>`).join('')}<span class="badge waiting-badge">대기 ${waiting.length}명</span></div><div class="team-grid">${cards}${waitingCard}</div><div class="notice ${waiting.length?'warning':'success'}" style="margin-top:12px">${waiting.length?`<b>대기 ${waiting.length}명:</b> ${waiting.map(x=>x.name).join(', ')} · 게임비와 경기횟수 제외`:'<b>대기 인원 없음</b> · 필요하면 배정 선택에서 대기로 변경하세요.'}</div>`;
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
  const dues=gameDues.filter(d=>d.meeting_id===m.id&&!d.deleted_at);
  $('gameFeeSummary').innerHTML=dues.length?'<div class="kpi"><div class="label">게임비 합계</div><div class="value">'+won(dues.reduce((n,d)=>n+Number(d.amount),0))+'</div></div>':'<div class="empty">게임비 내역이 없습니다.</div>';
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
        ?'<div class="field" style="margin-top:12px"><label>패배팀 1인당 게임비</label><input id="threeSeriesFee" type="number" min="0" step="1000" value="2000" inputmode="numeric"></div><button class="btn dark" style="width:100%;margin-top:12px" onclick="startThreeTeamSeries()">3팀 단판 시리즈 시작</button>'
        :'<div class="notice warning" style="margin-top:12px"><b>3팀 기능 준비 필요</b><br>Supabase에서 ALLIN_V55_Three_Team_Series_Update.sql을 실행하세요. 기존 회원·모임 기능은 정상 사용 가능합니다.</div>'}`;
  }else if(ts.length>=2){
    $('seriesStartArea').innerHTML=`${ts.length===4?'<div class="notice" style="margin-bottom:12px"><b>4팀 편성</b><br>경기할 두 팀을 선택하세요. 나머지 두 팀은 이번 시리즈에 참가하지 않습니다.</div>':''}<div class="form-grid">
      <div class="field"><label>A팀</label><select id="seriesTeamA">${ts.map(t=>`<option value="${t.id}">${t.team_name}</option>`).join('')}</select></div>
      <div class="field"><label>B팀</label><select id="seriesTeamB">${ts.map((t,i)=>`<option value="${t.id}" ${i===1?'selected':''}>${t.team_name}</option>`).join('')}</select></div>
      <div class="field"><label>경기 방식</label><select id="seriesBestOf"><option value="3">3판 2승제</option><option value="5">5판 3승제</option></select></div>
      <div class="field"><label>패배팀 1인당 게임비</label><input id="seriesFee" type="number" min="0" step="1000" value="2000" inputmode="numeric"></div>
    </div>
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
  const fee=Number($('threeSeriesFee')?.value);
  if(ts.length!==3)return toast('3팀 단판 시리즈는 정확히 3팀일 때만 시작할 수 있습니다.');
  if(!Number.isFinite(fee)||fee<0)return toast('게임비를 확인하세요.');
  const {data,error}=await sb.rpc('admin_start_three_team_series',{p_meeting_id:m.id});
  if(error)return toast(error.message);
  const {error:feeError}=await sb.rpc('admin_set_series_fee_v592',{p_series_kind:'three_team',p_series_id:data,p_fee_amount:fee});
  if(feeError)return toast('시리즈 게임비 저장 실패: '+feeError.message);
  toast(`3팀 단판 시리즈를 시작했습니다. · 1인당 ${won(fee)}`);
  await loadAll();
}
function renderThreeTeamArea(m,s){
  const rows=threeGamesForSeries(s.id);
  const pending=rows.find(g=>g.score_a===null||g.score_b===null);
  const fee=Number(s.manual_fee_amount??2000)*(s.reset_count>0?2:1);
  const phaseLabel=s.phase==='loser_final'?'최종 패자 결정전':'우승팀 결정';
  $('seriesArea').innerHTML=`<div class="grid g4">
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
    const s=threeTeamSeries.find(x=>x.id===id);toast(`${data.champion_name} 우승 · ${data.final_loser_name} 최종 패배 · 1인당 ${won(s?.manual_fee_amount??data.fee_amount)} 청구`);
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
  if(!m)return toast('운영할 모임을 선택하세요.');

  const teamA=$('seriesTeamA')?.value;
  const teamB=$('seriesTeamB')?.value;
  const bestOf=Number($('seriesBestOf')?.value||3);
  const fee=Number($('seriesFee')?.value);

  if(!teamA||!teamB||teamA===teamB)return toast('서로 다른 두 팀을 선택하세요.');
  if(!Number.isFinite(fee)||fee<0)return toast('게임비를 확인하세요.');

  const {data,error}=await sb.rpc('admin_start_match_series_v59',{
    p_meeting_id:m.id,
    p_team_a_id:teamA,
    p_team_b_id:teamB,
    p_best_of:bestOf
  });

  if(error)return toast(error.message);
  const {error:feeError}=await sb.rpc('admin_set_series_fee_v592',{p_series_kind:'normal',p_series_id:data,p_fee_amount:fee});
  if(feeError)return toast('시리즈 게임비 저장 실패: '+feeError.message);
  toast(`${bestOf===3?'3판 2승제':'5판 3승제'} 시리즈를 시작했습니다. · 1인당 ${won(fee)}`);
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
    <div class="kpi"><div class="label">게임비</div><div class="value">${won(active.manual_fee_amount??2000)}</div></div>
  </div>
  <div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>세트</th><th>${active.team_a_name}</th><th>${active.team_b_name}</th><th>결과</th></tr></thead><tbody>
  ${sets.map(x=>`<tr><td>${x.set_no}세트</td><td><b>${x.score_a}</b></td><td><b>${x.score_b}</b></td><td>${x.cold_game?'<span class="badge" style="background:#fee2e2;color:#991b1b">8:0 콜드</span>':(x.winner_side==='A'?active.team_a_name:active.team_b_name)+' 승'}</td></tr>`).join('')}
  </tbody></table></div>
  <button class="btn blue" style="width:100%;margin-top:12px" onclick="openSeriesSet('${active.id}')">${nextNo}세트 점수 입력</button>
  <button class="btn dark" style="width:100%;margin-top:8px" onclick="openDirectSeriesResult('${active.id}')">시리즈 결과 직접 입력</button>
  <button class="btn red small" style="width:100%;margin-top:8px" onclick="cancelSeries('${active.id}')">시리즈 취소</button>`;
}
function openDirectSeriesResult(seriesId){
  const s=matchSeries.find(x=>x.id===seriesId);if(!s)return;
  $('seriesResultId').value=seriesId;$('seriesResultTitle').textContent=`${s.series_no}차 시리즈 결과`;
  $('seriesResultALabel').textContent=s.team_a_name;$('seriesResultBLabel').textContent=s.team_b_name;
  $('seriesResultA').value='win';$('seriesResultB').value='loss';openModal('seriesResultModal');
}
async function saveDirectSeriesResult(){
  const id=$('seriesResultId').value,resultA=$('seriesResultA').value,resultB=$('seriesResultB').value;
  if((resultA==='win')===(resultB==='win'))return toast('한 팀만 승으로 선택하세요.');
  if(!confirm('결과를 확정하고 패배팀 전원에게 게임비를 청구할까요?'))return;
  const {data,error}=await sb.rpc('admin_complete_match_series_v593',{p_series_id:id,p_team_a_result:resultA,p_team_b_result:resultB});
  if(error)return toast(error.message);closeModal('seriesResultModal');
  toast(`${data.winner_name} 승 · ${data.loser_name} ${data.loser_result==='cold_loss'?'콜드패':'패'} · 1인당 ${won(data.fee_amount)} 청구`);await loadAll();
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
  if(data?.completed){const s=matchSeries.find(x=>x.id===id);toast(`${data.cold_ended?'8:0 콜드패 · 시리즈 즉시 종료':'시리즈 종료'} · ${data.winner_name} 승 / 패배팀 게임비 ${won(s?.manual_fee_amount??data.fee_amount)} 청구`);}
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
    return `<div style="padding:11px 0;border-bottom:1px solid #e5e7eb">
      <div><b>${s.series_no}차 · ${s.team_a_name} ${s.team_a_wins}:${s.team_b_wins} ${s.team_b_name}</b>
      <div style="font-size:12px;color:#6b7280">${m.meeting_date} · ${s.best_of===3?'3판 2승제':'5판 3승제'} · ${s.team_a_name} ${seriesResultLabel(s.team_a_result,s.winner_side==='A')} · ${s.team_b_name} ${seriesResultLabel(s.team_b_result,s.winner_side==='B')} · ${won(s.fee_amount)} 청구 · ${sets.length}세트</div></div>
      ${seriesSnapshotHtml('normal',s)}
    </div>`;
  }).join('');
  const tripleHtml=triple.map(s=>`<div style="padding:11px 0;border-bottom:1px solid #e5e7eb">
    <div><b>${s.series_no}차 · 3팀 단판 시리즈</b>
    <div style="font-size:12px;color:#6b7280">${m.meeting_date} · 3팀 단판 승자연전 · ${s.champion_name} 우승 · ${s.final_loser_name} 최종 패배 · 초기화 ${s.reset_count}회 · ${won(s.fee_amount)} 청구</div></div>
    ${seriesSnapshotHtml('three_team',s)}
  </div>`).join('');
  $('seriesHistory').innerHTML=(tripleHtml+normalHtml)||'<div class="empty">종료된 시리즈가 없습니다.</div>';
}
function seriesResultLabel(value,isWinner){return value==='cold_loss'?'콜드패':value==='loss'?'패':isWinner?'승':'패'}
function snapshotMemberNames(ids,names=[]){return (names?.length?names:(ids||[]).map(id=>members.find(m=>m.id===id)?.name).filter(Boolean)).join(', ')||'없음'}
function seriesSnapshotHtml(kind,s){
  let snaps=seriesTeamSnapshots.filter(x=>x.series_kind===kind&&x.series_id===s.id).sort((a,b)=>String(a.team_code).localeCompare(String(b.team_code)));
  if(!snaps.length){
    snaps=kind==='normal'?
      [{team_code:'A',team_name:s.team_a_name,member_ids:s.team_a_members},{team_code:'B',team_name:s.team_b_name,member_ids:s.team_b_members}]:
      [{team_code:'A',team_name:s.team_1_name,member_ids:s.team_1_members},{team_code:'B',team_name:s.team_2_name,member_ids:s.team_2_members},{team_code:'C',team_name:s.team_3_name,member_ids:s.team_3_members}];
  }
  return `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:7px;margin-top:9px">${snaps.map(x=>`<div class="notice" style="margin:0"><b>${x.team_code==='WAIT'?'대기':x.team_name||x.team_code+'팀'}</b><br><span style="font-size:12px">${snapshotMemberNames(x.member_ids,x.member_names)}</span></div>`).join('')}</div>`;
}
function memberStats(memberId){
  const att=attendance.filter(a=>a.member_id===memberId&&a.attending).length;
  const played=teamMembers.filter(tm=>tm.member_id===memberId).flatMap(tm=>games.filter(g=>g.team_a===tm.team_id||g.team_b===tm.team_id)).filter(g=>g.winner_team_id);
  const wins=played.filter(g=>teamMembers.some(tm=>tm.member_id===memberId&&tm.team_id===g.winner_team_id)).length;
  return {attendance:att,games:played.length,wins,winRate:played.length?Math.round(wins/played.length*100):0}
}
function gameDueSeriesKey(d){
  if(d.three_team_series_id)return 'T:'+d.three_team_series_id;
  if(d.series_id)return 'S:'+d.series_id;
  if(d.game_id)return 'G:'+d.game_id;
  return 'D:'+d.id;
}
function gameDueSeriesMeta(key,rows=[]){
  const [kind,id]=String(key).split(':');
  const first=rows[0]||{};
  const meeting=meetings.find(m=>m.id===first.meeting_id);
  const date=meeting?.meeting_date||first.due_date||'-';
  if(kind==='S'){
    const s=matchSeries.find(x=>x.id===id);
    const loser=s?.winner_side==='A'?s?.team_b_name:s?.winner_side==='B'?s?.team_a_name:
      s?.team_a_result==='win'?s?.team_b_name:s?.team_b_result==='win'?s?.team_a_name:'패배팀';
    return {date,title:`${s?.series_no||'-'}차 시리즈 · ${s?.team_a_name||'A팀'} vs ${s?.team_b_name||'B팀'}`,loser,kind:'2팀 시리즈'};
  }
  if(kind==='T'){
    const s=threeTeamSeries.find(x=>x.id===id);
    return {date,title:`${s?.series_no||'-'}차 3팀 단판 시리즈`,loser:s?.final_loser_name||'최종 패배팀',kind:'3팀 시리즈'};
  }
  if(kind==='G'){
    const g=games.find(x=>x.id===id),ta=teams.find(t=>t.id===g?.team_a),tb=teams.find(t=>t.id===g?.team_b),winner=teams.find(t=>t.id===g?.winner_team_id);
    const loser=winner?.id===ta?.id?tb?.team_name:winner?.id===tb?.id?ta?.team_name:'패배팀';
    return {date,title:`단판 경기 · ${ta?.team_name||'A팀'} vs ${tb?.team_name||'B팀'}`,loser,kind:'단판 경기'};
  }
  return {date,title:'게임비 수동/이전 기록',loser:'대상 회원',kind:'기타'};
}
function visibleGameFeeRows(month=currentDuesMonth()){
 return gameDues.filter(d=>!d.deleted_at&&monthKey(d.due_date)===month);
}
function renderReceivables(){
 if(!$('duesBody'))return;
 if(!$('duesMonth').value)$('duesMonth').value=new Date().toISOString().slice(0,7);
 const month=currentDuesMonth(),rows=visibleGameFeeRows(month),groups={};
 rows.forEach(d=>{const key=gameDueSeriesKey(d);(groups[key]??=[]).push(d);});
 $('duesByMeeting').innerHTML=Object.entries(groups).map(([key,items])=>({key,items,meta:gameDueSeriesMeta(key,items)})).sort((a,b)=>b.meta.date.localeCompare(a.meta.date)||b.meta.title.localeCompare(a.meta.title,'ko')).map(({key,items,meta})=>{
  const total=items.reduce((n,d)=>n+Number(d.amount),0),amounts=[...new Set(items.map(d=>Number(d.amount)))];
  return `<div class="card" style="margin-bottom:12px"><div class="row" style="justify-content:space-between"><div><b>${escapeFeeText(meta.title)}</b><div style="font-size:12px;color:#6b7280;margin-top:3px">${meta.date} · 패배팀 ${escapeFeeText(meta.loser)} · 1인당 ${amounts.map(won).join(' / ')} · 합계 ${won(total)}</div></div><div class="row"><button class="btn blue small" onclick="shareSeriesGameDues('${key}')">단톡방 공유</button><button class="btn small" onclick="copySeriesGameDues('${key}')">문구 복사</button><button class="btn red small" onclick="deleteSeriesGameFees('${key}')">게임비 삭제</button></div></div><div class="table-wrap" style="margin-top:10px"><table><thead><tr><th>대상 회원</th><th>게임비</th></tr></thead><tbody>${items.map(d=>({d,name:members.find(m=>m.id===d.member_id)?.name||'-'})).sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(({d,name})=>`<tr><td>${escapeFeeText(name)}</td><td>${won(d.amount)}</td></tr>`).join('')}</tbody></table></div></div>`;
 }).join('')||'<div class="empty">해당 월의 게임비 내역이 없습니다.</div>';
 const totals={};
 rows.forEach(d=>{const g=totals[d.member_id]??={total:0,keys:new Set()};g.total+=Number(d.amount);g.keys.add(gameDueSeriesKey(d));});
 gameFeeAdjustments.filter(a=>monthKey(a.adjustment_month)===month).forEach(a=>{const g=totals[a.member_id]??={total:0,keys:new Set()};g.total+=Number(a.charge_delta||0);});
 const memberRows=Object.entries(totals).map(([id,g])=>({id,name:members.find(m=>m.id===id)?.name||'-',...g}));
 const sum=memberRows.reduce((n,x)=>n+x.total,0);
 $('receivableKpis').innerHTML=[['게임비 합계',won(sum)],['시리즈·경기',Object.keys(groups).length+'건'],['대상 회원',memberRows.length+'명'],['선택 월',month]].map(([label,value])=>`<div class="card kpi"><div class="label">${label}</div><div class="value">${value}</div></div>`).join('');
 $('duesBody').innerHTML=memberRows.sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(x=>`<tr><td>${escapeFeeText(x.name)}</td><td>${won(x.total)}</td><td>${x.keys.size}경기</td><td><div class="row"><button class="btn blue small" onclick="shareMemberGameDues('${x.id}')">공유</button><button class="btn small" onclick="openGameFeeAdjustment('${x.id}','${month}')">수정</button><button class="btn small" onclick="openGameFeeHistory('${x.id}')">이력</button></div></td></tr>`).join('')||'<tr><td colspan="4" class="empty">게임비 내역이 없습니다.</td></tr>';
}
function memberGameFeeTotals(memberId,month){
 return {charge:visibleGameFeeRows(month).filter(d=>d.member_id===memberId).reduce((n,d)=>n+Number(d.amount),0)+gameFeeAdjustments.filter(a=>a.member_id===memberId&&monthKey(a.adjustment_month)===month).reduce((n,a)=>n+Number(a.charge_delta||0),0)};
}
async function openGameFeeAdjustment(memberId,month=currentDuesMonth()){
 await loadAll();window.allinAdjustmentMonth=month;
 $('gameFeeAdjustMemberId').value=memberId;$('gameFeeAdjustMemberLabel').value=(members.find(m=>m.id===memberId)?.name||'-')+' · '+month;
 $('gameFeeAdjustCharge').value=memberGameFeeTotals(memberId,month).charge;$('gameFeeAdjustReason').value='';openModal('gameFeeAdjustModal');
}
async function saveGameFeeAdjustment(){
 const memberId=$('gameFeeAdjustMemberId').value,month=window.allinAdjustmentMonth||currentDuesMonth(),raw=$('gameFeeAdjustCharge').value.trim(),amount=Number(raw),reason=$('gameFeeAdjustReason').value.trim();
 if(!raw||!Number.isSafeInteger(amount)||amount<0)return toast('게임비를 확인하세요.');if(reason.length<2)return toast('변경 사유를 입력하세요.');
 const {error}=await sb.rpc('admin_adjust_game_fee_charge_v600',{p_member_id:memberId,p_month:month+'-01',p_new_charge:amount,p_reason:reason});
 if(error)return toast('게임비 수정 실패: '+error.message);closeModal('gameFeeAdjustModal');await loadAll();toast('게임비를 수정했습니다.');
}
function openGameFeeHistory(memberId){
 $('gameFeeHistoryTitle').textContent=(members.find(m=>m.id===memberId)?.name||'회원')+' · 게임비 수정 이력';
 $('gameFeeHistoryBody').innerHTML=gameFeeAdjustments.filter(a=>a.member_id===memberId&&a.reason!=='게임비 합계 입금 확인').map(a=>`<div style="padding:11px 0;border-bottom:1px solid #e5e7eb"><b>${monthKey(a.adjustment_month)} · ${escapeFeeText(a.reason)}</b><div>게임비 ${won(a.charge_before)} → ${won(a.charge_after)}<br>${new Date(a.created_at).toLocaleString('ko-KR')}${a.deleted_at?'<br>삭제 '+new Date(a.deleted_at).toLocaleString('ko-KR'):''}</div>${!a.deleted_at&&!a.reversal_of?`<button class="btn red small" onclick="deleteGameFeeAdjustment('${a.id}','${memberId}')">삭제</button>`:''}</div>`).join('')||'<div class="empty">수정 이력이 없습니다.</div>';openModal('gameFeeHistoryModal');
}
async function deleteSeriesGameFees(key){
 const rows=visibleGameFeeRows().filter(d=>gameDueSeriesKey(d)===key);if(!rows.length)return toast('삭제할 게임비가 없습니다.');
 const meta=gameDueSeriesMeta(key,rows),amount=rows.reduce((n,d)=>n+Number(d.amount),0);
 if(!confirm(meta.date+' · '+meta.title+'의 게임비 '+won(amount)+' 내역을 삭제할까요?\n해당 시리즈의 게임비 전체가 합계에서 제외됩니다. 경기 결과와 팀 명단은 유지됩니다.'))return;
 const [kind,id]=key.split(':');const {data,error}=await sb.rpc('admin_delete_series_game_fees_v600',{p_series_kind:kind,p_source_id:id});
 if(error)return toast('게임비 삭제 실패: '+error.message);await loadAll();toast(data?.deleted_count?'시리즈 게임비를 삭제했습니다.':'이미 삭제된 게임비입니다.');
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

async function shareText(text,title='올인 족구단 게임비'){
  if(navigator.share){
    try{await navigator.share({title,text});return}catch(e){if(e.name==='AbortError')return}
  }
  await navigator.clipboard.writeText(text);
  toast('공유문구를 복사했습니다. 카카오톡 단톡방에 붙여넣으세요.');
}
function buildSeriesGameDuesShareText(key){
 const rows=visibleGameFeeRows().filter(d=>gameDueSeriesKey(d)===key);if(!rows.length)return '';
 const meta=gameDueSeriesMeta(key,rows),total=rows.reduce((n,d)=>n+Number(d.amount||0),0);
 const people=rows.map(d=>({name:members.find(m=>m.id===d.member_id)?.name||'-',amount:d.amount})).sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(x=>'• '+x.name+' : '+won(x.amount)).join('\n');
 return '⚽ 올인 족구단 게임비 안내\n\n📅 '+meta.date+'\n🏁 '+meta.title+'\n패배팀 : '+meta.loser+'\n1인당 게임비 : '+[...new Set(rows.map(d=>Number(d.amount)))].map(won).join(' / ')+'\n\n[게임비 대상]\n'+people+'\n\n게임비 합계 : '+won(total);
}
function shareSeriesGameDues(key){
  const text=buildSeriesGameDuesShareText(key);
  if(!text)return toast('공유할 시리즈 게임비가 없습니다.');
  shareText(text,'시리즈별 게임비 안내');
}
async function copySeriesGameDues(key){
  const text=buildSeriesGameDuesShareText(key);
  if(!text)return toast('복사할 시리즈 게임비가 없습니다.');
  await navigator.clipboard.writeText(text);toast('시리즈별 게임비 문구 복사 완료');
}
function shareMemberGameDues(memberId){
 const m=members.find(x=>x.id===memberId),rows=visibleGameFeeRows().filter(d=>d.member_id===memberId);
 const lines=rows.map(d=>'• '+d.due_date+' · '+gameDueSeriesMeta(gameDueSeriesKey(d),[d]).title+' : '+won(d.amount));
 const total=memberGameFeeTotals(memberId,currentDuesMonth()).charge;
 shareText('⚽ 올인 족구단 게임비 안내\n'+(m?.name||'회원')+'님 · '+currentDuesMonth()+'\n\n'+lines.join('\n')+'\n\n게임비 합계 : '+won(total),'개인 게임비 안내');
}
function escapeFeeText(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
async function deleteGameFeeAdjustment(id,memberId){
 if(!confirm('이 게임비 수정 내역을 삭제할까요? 해당 조정 차액을 취소하며 삭제 이력은 보존됩니다.'))return;
 const {error}=await sb.rpc('admin_delete_charge_adjustment_v600',{p_adjustment_id:id});
 if(error)return toast('삭제 실패: '+error.message);
 await loadAll();openGameFeeHistory(memberId);toast('수정 내역을 삭제했습니다.');
}

function teamGenerationEligibleCount(meetingId,includeWaiting=true){
  const meetingTeams=teams.filter(t=>t.meeting_id===meetingId);
  const teamIds=new Set(meetingTeams.map(t=>t.id));
  const assignedIds=new Set(teamMembers.filter(tm=>teamIds.has(tm.team_id)).map(tm=>tm.member_id));
  return attendance.filter(a=>a.meeting_id===meetingId&&a.attending===true&&(includeWaiting||!meetingTeams.length||assignedIds.has(a.member_id))).length;
}
