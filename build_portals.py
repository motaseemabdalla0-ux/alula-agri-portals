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
  const sub='استبيان إنتاج التمور والحمضيات',after=()=>{try{syncOutbox();pullFromServer(true)}catch(e){}};
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
