let meeting=null, members=[], loginMember=null, loginPin='';

async function memberLogin(){
  const name=$('memberLoginId').value.trim();
  const pin=$('memberLoginPw').value.trim();
  if(!name)return showLoginError('회원 이름을 입력하세요.');
  if(!/^\d{4}$/.test(pin))return showLoginError('개인 PIN 4자리를 입력하세요.');
  if(!requireConfig())return;
  const {data,error}=await sb.rpc('member_login_v53',{p_name:name,p_pin:pin});
  if(error){console.error(error);sessionStorage.removeItem('allin_member_session');return showLoginError('회원 로그인 처리 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.');}
  if(!data?.ok)return showLoginError(data?.message||'이름 또는 PIN을 확인하세요.');
  loginMember=data.member;loginPin=pin;
  sessionStorage.setItem('allin_member_session',JSON.stringify({member:loginMember,pin:loginPin}));
  $('memberLoginError').textContent='';showMemberApp();await initPortal();
}
function showLoginError(msg){$('memberLoginError').textContent=msg}
function memberLogout(){
  sessionStorage.removeItem('allin_member_session');
  loginMember=null;
  loginPin='';
  meeting=null;
  members=[];
  const pw=$('memberLoginPw');
  const err=$('memberLoginError');
  const app=$('memberAppView');
  const login=$('memberLoginView');
  if(pw)pw.value='';
  if(err)err.textContent='';
  if(app)app.classList.add('hidden');
  if(login)login.classList.remove('hidden');
  const id=$('memberLoginId');
  if(id)id.focus();
}

function showMemberApp(){$('memberLoginView').classList.add('hidden');$('memberAppView').classList.remove('hidden');$('loginMemberName').textContent=loginMember?.name||''}
async function init(){
  try{const saved=JSON.parse(sessionStorage.getItem('allin_member_session')||'null');if(saved?.member&&saved?.pin){loginMember=saved.member;loginPin=saved.pin;showMemberApp();await initPortal()}}catch(e){}
}
async function initPortal(){
  startGameFeeRefresh();
  if(!requireConfig()){$('configWarn').classList.remove('hidden');$('meetingDate').textContent='연결 설정 필요';return}
  await loadPortal();if(!$('memberDashMonth').value)$('memberDashMonth').value=new Date().toISOString().slice(0,7);await loadMemberDashboard();
  sb.channel('member-portal-v53').on('postgres_changes',{event:'*',schema:'public',table:'attendance'},()=>loadPortal(true)).on('postgres_changes',{event:'*',schema:'public',table:'meetings'},()=>loadPortal(true)).subscribe();
}
async function loadPortal(silent=false){
  const {data,error}=await sb.rpc('get_member_portal_v53');
  if(error){if(!silent)toast('데이터를 불러오지 못했습니다.');console.error(error);return}
  meeting=data?.meeting||null;members=data?.members||[];
  $('meetingDate').textContent=meeting?.date||'예정된 모임 없음';
  $('meetingMeta').textContent=meeting?`참석 ${data.attending_count||0}명 · 불참 ${data.absent_count||0}명 · 미응답 ${data.pending_count||0}명`:'총무가 모임을 생성하면 표시됩니다.';
  renderAttendance(data||{});
  renderMyStatus();
}
function renderAttendance(data){
  const attending=members.filter(x=>x.attending===true), absent=members.filter(x=>x.attending===false), pending=members.filter(x=>x.attending===null||typeof x.attending==='undefined');
  $('attendanceSummary').innerHTML=`<div class="attendance-kpi yes"><b>${attending.length}</b><span>참석</span></div><div class="attendance-kpi no"><b>${absent.length}</b><span>불참</span></div><div class="attendance-kpi pending"><b>${pending.length}</b><span>미응답</span></div>`;
  const people=(title,rows,cls)=>`<div class="attendance-group ${cls}"><div class="attendance-group-title">${title} <b>${rows.length}명</b></div><div class="attendance-names">${rows.length?rows.map(x=>`<span>${x.name}</span>`).join(''):'<em>없음</em>'}</div></div>`;
  $('attendancePeople').innerHTML=people('참석 인원',attending,'yes')+people('불참 인원',absent,'no')+people('미응답 인원',pending,'pending');
}
function renderMyStatus(){
  if(!loginMember){$('checkPanel').classList.add('hidden');return}
  const mine=members.find(x=>x.id===loginMember.id);
  $('checkPanel').classList.toggle('hidden',!meeting);
  if(!meeting){$('currentStatus').innerHTML='<div class="status no">현재 개설된 모임이 없습니다.</div>';return}
  if(!mine||mine.attending===null||typeof mine.attending==='undefined')$('currentStatus').innerHTML=`<div class="status pending">${loginMember.name}님 · 아직 참석 여부를 선택하지 않았습니다.</div>`;
  else $('currentStatus').innerHTML=mine.attending?`<div class="status yes">${loginMember.name}님 · 참석으로 체크됨 ✓</div>`:`<div class="status no">${loginMember.name}님 · 불참으로 체크됨</div>`;
}
let attendanceSaving=false;
async function setAttendance(attending){
  if(attendanceSaving)return;
  if(!meeting||!loginMember)return toast('현재 개설된 모임이 없습니다.');

  attendanceSaving=true;
  document.querySelectorAll('#checkPanel button').forEach(btn=>btn.disabled=true);

  try{
    const {data,error}=await sb.rpc('set_my_attendance',{
      p_meeting_id:meeting.id,
      p_member_id:loginMember.id,
      p_pin:loginPin,
      p_attending:attending
    });

    if(error){
      console.error('set_my_attendance error',error);
      return toast(error.message||'참석 여부 저장 중 오류가 발생했습니다.');
    }
    if(!data?.ok)return toast(data?.message||'참석 여부를 저장하지 못했습니다.');

    toast(attending?'참석 체크 완료!':'불참으로 변경했습니다.');
    await loadPortal(true);
  }finally{
    attendanceSaving=false;
    document.querySelectorAll('#checkPanel button').forEach(btn=>btn.disabled=false);
  }
}
init();

function openDelegateAdmin(){
  if(!loginMember||!loginPin)return toast('회원 로그인이 필요합니다.');
  location.href='operation.html';
}

async function loadMemberDashboard(){
 if(!sb||!loginMember?.id||!$('memberDashMonth'))return;
 const month=$('memberDashMonth').value||new Date().toISOString().slice(0,7);
 const memberId=loginMember.id,pin=loginPin;
 const {data,error}=await sb.rpc('member_get_game_fees_v600',{p_month:month+'-01',p_member_id:memberId,p_pin:pin});
 if(loginMember?.id!==memberId||loginPin!==pin||($('memberDashMonth').value&&$('memberDashMonth').value!==month))return;
 if(error){console.error(error);$('gameDueDashboard').textContent='게임비를 불러오지 못했습니다. 다시 시도하세요.';return;}
 const d=data||{},esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 $('gameDueDashboard').innerHTML='<div class="kpi"><div class="label">게임비 합계</div><div class="value">'+won(d.total_amount)+'</div></div><div class="table-wrap"><table><thead><tr><th>일자</th><th>시리즈</th><th>게임비</th></tr></thead><tbody>'+(d.items||[]).map(x=>'<tr><td>'+esc(x.due_date)+'</td><td>'+esc(x.title)+'</td><td>'+won(x.amount)+'</td></tr>').join('')+'</tbody></table></div>'+(d.adjustment_amount?'<div class="notice">수동 조정 '+won(d.adjustment_amount)+'</div>':'')+(!(d.items||[]).length?'<div class="empty">시리즈 게임비 내역이 없습니다.</div>':'');
}
let gameFeeRefreshStarted=false;
function startGameFeeRefresh(){
 if(gameFeeRefreshStarted)return;gameFeeRefreshStarted=true;
 const refresh=()=>{if(loginMember&&!document.hidden)loadMemberDashboard().catch(console.error);};
 setInterval(refresh,15000);document.addEventListener('visibilitychange',refresh);window.addEventListener('online',refresh);
}
