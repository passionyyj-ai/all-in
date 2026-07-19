(() => {
  const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
  const isIOS=/iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid=/android/i.test(navigator.userAgent);
  const appKind=document.body?.dataset?.appKind||'member';
  const storageKey=`allin-install-tip-dismissed-${appKind}`;
  const updateKey=`allin-update-dismissed-${appKind}`;
  let deferredPrompt=null;
  const qs=id=>document.getElementById(id);
  function createUi(){
    if(qs('pwaInstallBar'))return;
    const bar=document.createElement('div');bar.id='pwaInstallBar';bar.className='pwa-install-bar';
    bar.innerHTML=`<div class="pwa-install-copy"><b>📱 홈 화면에 설치</b><span id="pwaInstallText">ALLIN을 앱처럼 빠르게 실행하세요.</span></div><div class="pwa-install-actions"><button type="button" id="pwaInstallBtn" class="pwa-install-btn">설치하기</button><button type="button" id="pwaInstallClose" class="pwa-install-close" aria-label="닫기">×</button></div>`;
    document.body.appendChild(bar);
    const offline=document.createElement('div');offline.id='offlineBanner';offline.className='offline-banner';offline.textContent='인터넷 연결이 끊겼습니다. 저장 기능은 연결 복구 후 다시 시도하세요.';document.body.appendChild(offline);
    const update=document.createElement('div');update.id='pwaUpdateBar';update.className='pwa-update-bar';update.innerHTML=`<span>새 버전이 준비되었습니다.</span><button type="button" id="pwaUpdateBtn">지금 업데이트</button><button type="button" id="pwaUpdateClose" aria-label="닫기">×</button>`;document.body.appendChild(update);
    qs('pwaInstallBtn')?.addEventListener('click',installApp);
    qs('pwaInstallClose')?.addEventListener('click',()=>{localStorage.setItem(storageKey,Date.now().toString());hideInstallBar();});
    qs('pwaUpdateClose')?.addEventListener('click',()=>{sessionStorage.setItem(updateKey,'1');qs('pwaUpdateBar')?.classList.remove('show');});
  }
  function showInstallBar(message,mode='install'){if(isStandalone())return;const bar=qs('pwaInstallBar'),text=qs('pwaInstallText'),btn=qs('pwaInstallBtn');if(!bar||!text||!btn)return;text.textContent=message;btn.textContent=mode==='ios'?'설치 방법':'설치하기';btn.dataset.mode=mode;bar.classList.add('show');}
  function hideInstallBar(){qs('pwaInstallBar')?.classList.remove('show');}
  function showIosGuide(){let modal=qs('iosInstallGuide');if(!modal){modal=document.createElement('div');modal.id='iosInstallGuide';modal.className='pwa-guide-backdrop';modal.innerHTML=`<div class="pwa-guide-card"><button type="button" class="pwa-guide-close" aria-label="닫기">×</button><h3>iPhone 홈 화면에 설치</h3><ol><li>Safari 하단의 <b>공유</b> 버튼을 누릅니다.</li><li><b>홈 화면에 추가</b>를 선택합니다.</li><li>오른쪽 위의 <b>추가</b>를 누릅니다.</li></ol><button type="button" class="pwa-guide-confirm">확인</button></div>`;document.body.appendChild(modal);modal.querySelector('.pwa-guide-close')?.addEventListener('click',()=>modal.classList.remove('show'));modal.querySelector('.pwa-guide-confirm')?.addEventListener('click',()=>modal.classList.remove('show'));modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('show');});}modal.classList.add('show');}
  async function installApp(){const mode=qs('pwaInstallBtn')?.dataset?.mode;if(mode==='ios'){showIosGuide();return;}if(!deferredPrompt){alert('Chrome 메뉴에서 “앱 설치” 또는 “홈 화면에 추가”를 선택해 주세요.');return;}deferredPrompt.prompt();const choice=await deferredPrompt.userChoice;if(choice.outcome==='accepted')hideInstallBar();deferredPrompt=null;}
  function updateOnlineState(){qs('offlineBanner')?.classList.toggle('show',!navigator.onLine);}
  function setupInstallPrompt(){window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredPrompt=event;if(!localStorage.getItem(storageKey))showInstallBar('ALLIN을 앱처럼 빠르게 실행하세요.');});window.addEventListener('appinstalled',()=>{deferredPrompt=null;hideInstallBar();const done=document.createElement('div');done.className='pwa-installed-toast';done.textContent='✅ ALLIN 앱 설치 완료';document.body.appendChild(done);setTimeout(()=>done.remove(),2500);});if(isIOS&&!isStandalone()&&!localStorage.getItem(storageKey)){showInstallBar('Safari 공유 버튼에서 홈 화면에 추가할 수 있습니다.','ios');}else if(isAndroid&&!isStandalone()){setTimeout(()=>{if(!deferredPrompt&&!localStorage.getItem(storageKey))showInstallBar('Chrome 메뉴에서도 “앱 설치”를 선택할 수 있습니다.');},1800);}}
  function setupServiceWorkerUpdates(){if(!('serviceWorker'in navigator))return;navigator.serviceWorker.getRegistration().then(reg=>{if(!reg)return;const showUpdate=worker=>{if(sessionStorage.getItem(updateKey)==='1')return;const bar=qs('pwaUpdateBar');if(!bar)return;bar.classList.add('show');qs('pwaUpdateBtn').onclick=()=>worker.postMessage({type:'SKIP_WAITING'});};if(reg.waiting)showUpdate(reg.waiting);reg.addEventListener('updatefound',()=>{const worker=reg.installing;if(!worker)return;worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate(worker);});});setInterval(()=>reg.update().catch(()=>{}),30*60*1000);});let refreshing=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;location.reload();});}
  window.addEventListener('online',updateOnlineState);window.addEventListener('offline',updateOnlineState);
  document.addEventListener('DOMContentLoaded',()=>{createUi();updateOnlineState();setupInstallPrompt();setupServiceWorkerUpdates();});
})();