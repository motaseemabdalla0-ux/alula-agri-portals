"""Assemble the website from the workspace sources.

    python build_portals.py

auction/index.html  <- ../alula-date-auction/dist/public/index.html  (run `python build.py --public` there first;
                       it has no farmers' or buyers' data — the page loads it from the database after sign-in)
survey/index.html   <- ../farm-production-survey.html, connected to the same database and sign-in
assets/sb.js        <- ../alula-date-auction/src/sb.js with the project's public key (sign-in + database access)
"""
import pathlib, sys

ROOT = pathlib.Path(__file__).parent
WS = ROOT.parent
key_file = WS / 'alula-date-auction' / 'sb_key.txt'
if not key_file.exists():
    sys.exit('missing alula-date-auction/sb_key.txt (Supabase public key)')
key = key_file.read_text(encoding='utf-8').strip()

(ROOT / 'assets' / 'sb.js').write_text((WS / 'alula-date-auction' / 'src' / 'sb.js').read_text(encoding='utf-8').replace('__SB_KEY__', key), encoding='utf-8')

auction = WS / 'alula-date-auction' / 'dist' / 'public' / 'index.html'
if not auction.exists():
    sys.exit('build the auction first: cd alula-date-auction && python build.py --public')
html = auction.read_text(encoding='utf-8')
for name in ('مطلق صويلح', 'عبدي سالم برك'):  # guard: the public page must not carry personal data
    if name in html:
        sys.exit('auction page still contains personal data — use build.py --public')
(ROOT / 'auction' / 'index.html').write_text(html, encoding='utf-8')

survey = (WS / 'farm-production-survey.html').read_text(encoding='utf-8')
if survey.count("const ENDPOINT=''") != 1:
    sys.exit('survey: ENDPOINT line not found')
survey = survey.replace("const ENDPOINT=''", "const ENDPOINT='supabase'")
ADAPTER = r'''<script src="../assets/sb.js"></script>
<script>
/* the survey's central register is the shared database: same calls ("submit", "list"), answered by Supabase */
(()=>{if(!window.SB||!SB.configured)return;
  window.post=async function(p){
    if(p.action==='submit'){await SB.rest('surveys?on_conflict=record_id',{method:'POST',body:[{record_id:p.record.recordId,data:p.record}],headers:{Prefer:'resolution=merge-duplicates,return=minimal'}});return {ok:true,recordId:p.record.recordId}}
    if(p.action==='delete'){await SB.rest('surveys?record_id=eq.'+encodeURIComponent(p.recordId),{method:'DELETE',headers:{Prefer:'return=minimal'}});return {ok:true}}
    if(p.action==='list'){const rows=await SB.all('surveys','select=data&order=record_id.asc');
      const del=new Set(window.surveyPendingDeletes?surveyPendingDeletes():[]),list=rows.map(r=>r.data).filter(r=>r&&!del.has(r.recordId)),ids=new Set(list.map(r=>r.recordId));
      /* surveys deleted on another device: drop this device's copy, but only of ones it had already seen in the register and has nothing unsent for */
      const SEEN='dates-survey-seen-v1';let seen=[];try{seen=JSON.parse(localStorage.getItem(SEEN)||'[]')||[]}catch(e){}
      const gone=seen.filter(id=>!ids.has(id)&&!outbox.includes(id));
      if(gone.length&&(list.length||gone.length<=3)){records=records.filter(r=>!gone.includes(r.recordId));persistRecords()}
      try{localStorage.setItem(SEEN,JSON.stringify([...ids]))}catch(e){}
      return {ok:true,records:list}}
    return {ok:false,error:'unknown_action'}};
  /* farmers registered in the auction: suggested while typing the farmer's name (kept for offline use) */
  const FK='dates-survey-farmers-cache';
  try{const c=JSON.parse(localStorage.getItem(FK)||'null');if(c&&window.surveySetFarmers)surveySetFarmers(c)}catch(e){}
  async function loadFarmers(){try{const rows=await SB.all('auction_records','select=data&kind=eq.sellers&order=id.asc');
    const list=rows.map(r=>r.data).filter(s=>s&&s.sellerName).map(s=>({name:s.sellerName,phone:s.contactNumber||'',region:s.region||'',farmId:s.farmId||'',rid:s.rid||'',source:'auction'}));
    if(window.surveySetFarmers)surveySetFarmers(list);try{localStorage.setItem(FK,JSON.stringify(list))}catch(e){}}catch(e){}}
  setInterval(()=>{if(!document.hidden&&SB.signedIn)loadFarmers()},10*60*1000);
  /* header: switch to the auction, sync now */
  const tb=document.querySelector('.topbar');
  if(tb){tb.insertAdjacentHTML('beforeend',`<nav class="pt-sw" aria-label="البوابات"><a href="../auction/">المزاد</a><a class="on" aria-current="page">الاستبيان</a></nav><button type="button" class="pt-sync" title="مزامنة الآن: إرسال المعلّق وجلب آخر البيانات"><svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/></svg><span>مزامنة</span></button>`);
    const sb=tb.querySelector('.pt-sync');sb.onclick=async()=>{if(sb.classList.contains('busy'))return;sb.classList.add('busy');
      try{if(!SB.signedIn)await SB.gate({sub:'استبيان إنتاج التمور والحمضيات'});await syncOutbox(true);await pullFromServer(false);await loadFarmers()}finally{sb.classList.remove('busy')}};
    const st=document.createElement('style');st.textContent=`.pt-sw{display:inline-flex;background:var(--n-100,#EEF0F2);border-radius:999px;padding:3px;gap:2px;flex-shrink:0}
.pt-sw a{padding:5px 12px;border-radius:999px;font-size:13px;font-weight:700;color:var(--text-muted,#6B7280);text-decoration:none}
.pt-sw a.on{background:#fff;color:var(--g-600,#166B37);box-shadow:0 1px 2px rgba(16,20,24,.08)}.pt-sw a:not(.on):hover{color:var(--g-600,#166B37)}
.pt-sync{display:inline-flex;align-items:center;gap:6px;height:34px;padding:0 12px;border-radius:999px;border:1px solid var(--border,#E3E6EA);background:#fff;font:inherit;font-size:13px;font-weight:700;color:var(--g-600,#166B37);flex-shrink:0}
.pt-sync svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.pt-sync.busy svg{animation:ptspin 1s linear infinite}@keyframes ptspin{to{transform:rotate(360deg)}}
@media(max-width:760px){.pt-sync span{display:none}.pt-sync{padding:0 9px}.tb-date{display:none!important}.topbar{gap:8px!important;padding:0 10px!important}.topbar .crumbs{display:none!important}.topbar .sync-pill #syncText{display:none}.topbar .sync-pill{padding:0 10px!important}.pt-sw a{padding:5px 10px;font-size:12px}}`;document.head.append(st)}
  const sub='استبيان إنتاج التمور والحمضيات',after=()=>{try{syncOutbox();pullFromServer(true)}catch(e){}loadFarmers()};
  /* chosen sign-out reloads; an expired session only asks to sign in again — answers and the draft stay on the device */
  document.addEventListener('sb:signout',e=>{if(e.detail&&e.detail.user)location.reload();else SB.gate({sub,note:'إجاباتك محفوظة على هذا الجهاز وتُرسل بعد الدخول.'}).then(after)});
  SB.gate({sub}).then(after);
})();
</script>
'''
if survey.count('</body>') != 1:
    sys.exit('survey: </body> not found')
survey = survey.replace('</body>', ADAPTER + '</body>')
(ROOT / 'survey' / 'index.html').write_text(survey, encoding='utf-8')
print('ok')
