let meeting=null, members=[], selected=null;
function memberLogin(){simpleLogin('member','memberLoginId','memberLoginPw','memberLoginError',()=>{showMemberApp();initPortal()})}
function showMemberApp(){$('memberLoginView').classList.add('hidden');$('memberAppView').classList.remove('hidden')}
async function init(){if(sessionStorage.getItem('allin_auth_member')==='ok'){showMemberApp();await initPortal()}}
async function initPortal(){
  if(!requireConfig()){$('configWarn').classList.remove('hidden');$('meetingDate').textContent='연결 설정 필요';return}
  await loadPortal(); if(!$('memberDashMonth').value)$('memberDashMonth').value=new Date().toISOString().slice(0,7); await loadMemberDashboard();
  sb.channel('member-portal').on('postgres_changes',{event:'*',schema:'public',table:'attendance'},()=>loadPortal(true)).on('postgres_changes',{event:'*',schema:'public',table:'meetings'},()=>loadPortal(true)).subscribe();
}
async function loadPortal(silent=false){
  const {data,error}=await sb.rpc('get_member_portal');
  if(error){if(!silent)toast('데이터를 불러오지 못했습니다.');console.error(error);return}
  meeting=data?.meeting||null;members=data?.members||[];
  $('meetingDate').textContent=meeting?.date||'예정된 모임 없음';
  $('meetingMeta').textContent=meeting?`현재 참석 ${data.attending_count||0}명 · 일요일 모임`:'총무가 모임을 생성하면 표시됩니다.';
  renderMembers();
  if(selected){selected=members.find(x=>x.id===selected.id)||null;renderStatus()}
}
function renderMembers(){
  const q=$('memberSearch').value.trim();
  const rows=members.filter(m=>!q||m.name.includes(q));
  $('memberList').innerHTML=rows.length?rows.map(m=>`<button class="member-pick ${selected?.id===m.id?'selected':''}" onclick="pickMember('${m.id}')"><b>${m.name}</b>${badge(m.position)}</button>`).join(''):'<div class="empty">검색 결과가 없습니다.</div>';
}
function pickMember(id){selected=members.find(m=>m.id===id);$('pin').value='';renderMembers();renderStatus();$('checkPanel').classList.remove('hidden')}
function renderStatus(){
  if(!selected)return;
  $('currentStatus').innerHTML=selected.attending?`<div class="status yes">${selected.name}님 · 현재 참석으로 체크됨 ✓</div>`:`<div class="status no">${selected.name}님 · 현재 불참 상태</div>`;
}
async function setAttendance(attending){
  if(!meeting||!selected)return toast('모임과 회원을 선택하세요.');
  const pin=$('pin').value.trim();if(!/^\d{4}$/.test(pin))return toast('4자리 PIN을 입력하세요.');
  const {data,error}=await sb.rpc('set_my_attendance',{p_meeting_id:meeting.id,p_member_id:selected.id,p_pin:pin,p_attending:attending});
  if(error){console.error(error);return toast('처리 중 오류가 발생했습니다.')}
  if(!data?.ok)return toast(data?.message||'PIN을 확인하세요.');
  toast(attending?'참석 체크 완료!':'불참으로 변경했습니다.');
  $('pin').value='';await loadPortal(true);
}
$('memberSearch').addEventListener('input',renderMembers);
init();

async function loadMemberDashboard(){
  if(!sb||!$('memberDashMonth'))return;
  const month=$('memberDashMonth').value||new Date().toISOString().slice(0,7);
  const {data,error}=await sb.rpc('get_member_dashboard',{p_month:month+'-01'});
  if(error){console.error(error);return toast('대시보드 조회 중 오류가 발생했습니다.')}
  const d=data||{}, fee=d.fee||{}, cash=d.cash||{}, dues=d.game_dues||{};
  $('memberDashboardKpis').innerHTML=[
    ['현재 잔액',won(cash.balance||0)],
    ['당월 수입',won(cash.income||0)],
    ['당월 지출',won(cash.expense||0)],
    ['게임비 미납',won(dues.unpaid_amount||0)]
  ].map(x=>`<div class="card kpi"><div class="label">${x[0]}</div><div class="value">${x[1]}</div></div>`).join('');
  $('feeDashboard').innerHTML=`<div class="grid g4">
    <div class="kpi"><div class="label">대상 회원</div><div class="value">${fee.total||0}명</div></div>
    <div class="kpi"><div class="label">납부</div><div class="value">${fee.paid||0}명</div></div>
    <div class="kpi"><div class="label">미납</div><div class="value">${fee.unpaid||0}명</div></div>
    <div class="kpi"><div class="label">납부율</div><div class="value">${fee.rate||0}%</div></div>
  </div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>회원</th><th>상태</th><th>납부일</th></tr></thead><tbody>${(fee.members||[]).map(x=>`<tr><td><b>${x.name}</b></td><td>${x.paid?'<span class="badge" style="background:#dcfce7;color:#166534">납부</span>':'<span class="badge">미납</span>'}</td><td>${x.paid_date||'-'}</td></tr>`).join('')}</tbody></table></div>`;
  $('cashDashboard').innerHTML=`<div class="grid g4">
    <div class="kpi"><div class="label">당월 수입</div><div class="value">${won(cash.income||0)}</div></div>
    <div class="kpi"><div class="label">당월 지출</div><div class="value">${won(cash.expense||0)}</div></div>
    <div class="kpi"><div class="label">당월 증감</div><div class="value">${won((cash.income||0)-(cash.expense||0))}</div></div>
    <div class="kpi"><div class="label">현재 잔액</div><div class="value">${won(cash.balance||0)}</div></div>
  </div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>일자</th><th>구분</th><th>항목</th><th>금액</th></tr></thead><tbody>${(cash.recent||[]).map(x=>`<tr><td>${x.date}</td><td>${x.type==='income'?'수입':'지출'}</td><td>${x.category}</td><td class="${x.type==='income'?'money-in':'money-out'}">${x.type==='income'?'+':'-'} ${won(x.amount)}</td></tr>`).join('')}</tbody></table></div>`;
  $('gameDueDashboard').innerHTML=`<div class="grid g4">
    <div class="kpi"><div class="label">총 청구</div><div class="value">${won(dues.total_amount||0)}</div></div>
    <div class="kpi"><div class="label">납부</div><div class="value">${won(dues.paid_amount||0)}</div></div>
    <div class="kpi"><div class="label">미납</div><div class="value">${won(dues.unpaid_amount||0)}</div></div>
    <div class="kpi"><div class="label">미납 건수</div><div class="value">${dues.unpaid_count||0}건</div></div>
  </div><div class="table-wrap" style="margin-top:12px"><table><thead><tr><th>발생일</th><th>회원</th><th>금액</th><th>상태</th></tr></thead><tbody>${(dues.items||[]).map(x=>`<tr><td>${x.due_date}</td><td><b>${x.name}</b></td><td>${won(x.amount)}</td><td>${x.status==='paid'?'<span class="badge" style="background:#dcfce7;color:#166534">납부</span>':'<span class="badge">미납</span>'}</td></tr>`).join('')}</tbody></table></div>`;
}
