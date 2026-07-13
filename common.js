const CFG = window.ALLIN_CONFIG || {};
const $ = id => document.getElementById(id);
const POSITIONS = ['공격','토스','좌수비','우수비'];
const posClass = {'공격':'attack','토스':'toss','좌수비':'left','우수비':'right'};
const won = n => Number(n||0).toLocaleString('ko-KR')+'원';
const today = () => new Date().toISOString().slice(0,10);
const monthKey = d => String(d||'').slice(0,7);
const badge = p => `<span class="badge ${posClass[p]||''}">${p}</span>`;
function toast(msg){let el=$('toast');if(!el){el=document.createElement('div');el.id='toast';el.className='toast';document.body.appendChild(el)}el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2200)}
function configured(){return CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('YOUR_') && CFG.SUPABASE_PUBLISHABLE_KEY && !CFG.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')}
const sb = configured() ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY) : null;
function requireConfig(){if(!sb){alert('config.js에 Supabase URL과 Publishable key를 입력하세요.');return false}return true}
