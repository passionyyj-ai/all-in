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
  const referee=$('currentReferee');
  if(referee){
    referee.classList.toggle('hidden',!data?.referee_name);
    referee.innerHTML=data?.referee_name?`<b>오늘의 심판</b><span>${data.referee_name}</span>`:'';
  }
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
  if(!sb||!$('memberDashMonth'))return;
  const month=$('memberDashMonth').value||new Date().toISOString().slice(0,7);
  const {data,error}=await sb.rpc('get_my_member_dashboard',{p_month:month+'-01',p_member_id:loginMember?.id,p_pin:loginPin});
  if(error){console.error(error);return toast('현황 조회 중 오류가 발생했습니다.')}
  const d=data||{}, fee=d.fee||{}, cash=d.cash||{}, dues=d.game_dues||{};
  $('feeDashboard').innerHTML=`<div class="grid g4">
    <div class="kpi"><div class="label">대상 회원</div><div class="value">${fee.total||0}명</div></div>
    <div class="kpi"><div class="label">납부</div><div class="value">${fee.paid||0}명</div></div>
    <div class="kpi"><div class="label">미납</div><div class="value">${fee.unpaid||0}명</div></div>
    <div class="kpi"><div class="label">납부율</div><div class="value">${fee.rate||0}%</div></div>
  </div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>회원</th><th>상태</th><th>납부일</th></tr></thead><tbody>${(fee.members||[]).map(x=>`<tr><td><b>${x.name}</b></td><td>${x.paid?'<span class="badge" style="background:#dcfce7;color:#166534">납부</span>':'<span class="badge" style="background:#fee2e2;color:#991b1b">미납</span>'}</td><td>${x.paid_date||'-'}</td></tr>`).join('')}</tbody></table></div>`;
  $('cashDashboard').innerHTML=`<div class="grid g4"><div class="kpi"><div class="label">당월 수입</div><div class="value">${won(cash.income||0)}</div></div><div class="kpi"><div class="label">당월 지출</div><div class="value">${won(cash.expense||0)}</div></div><div class="kpi"><div class="label">당월 증감</div><div class="value">${won((cash.income||0)-(cash.expense||0))}</div></div><div class="kpi"><div class="label">현재 잔액</div><div class="value">${won(cash.balance||0)}</div></div></div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>일자</th><th>구분</th><th>항목</th><th>금액</th></tr></thead><tbody>${(cash.recent||[]).map(x=>`<tr><td>${x.date}</td><td>${x.type==='income'?'수입':'지출'}</td><td>${x.category}</td><td class="${x.type==='income'?'money-in':'money-out'}">${x.type==='income'?'+':'-'} ${won(x.amount)}</td></tr>`).join('')}</tbody></table></div>`;
  $('gameDueDashboard').innerHTML=`<div class="grid g4"><div class="kpi"><div class="label">총 청구</div><div class="value">${won(dues.total_amount||0)}</div></div><div class="kpi"><div class="label">납부</div><div class="value">${won(dues.paid_amount||0)}</div></div><div class="kpi"><div class="label">게임비 잔액</div><div class="value">${won(dues.unpaid_amount||0)}</div></div><div class="kpi"><div class="label">게임 횟수</div><div class="value">${dues.game_count||0}경기</div></div></div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>회원</th><th>총 청구</th><th>납부</th><th>게임비 잔액</th></tr></thead><tbody>${(()=>{const x=(dues.items||[]).find(v=>v.id===loginMember?.id)||(dues.items||[])[0];return x?`<tr><td><b>${x.name}</b></td><td>${won(x.total_amount||0)}</td><td class="money-in">${won(x.paid_amount||0)}</td><td class="${(x.unpaid_amount||0)>0?'money-out':''}">${won(x.unpaid_amount||0)}</td></tr>`:'<tr><td colspan="4">게임비 내역이 없습니다.</td></tr>'})()}</tbody></table></div>`;
}
