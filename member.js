let meeting=null, members=[], selected=null;
async function init(){
  if(!requireConfig()){$('configWarn').classList.remove('hidden');$('meetingDate').textContent='연결 설정 필요';return}
  await loadPortal();
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
