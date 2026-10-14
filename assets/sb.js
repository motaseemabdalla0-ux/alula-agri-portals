/* Shared login + database access for the AlUla agriculture portals (Supabase, no library).
   One team account; the session is shared by every page on the same site.
   The key below is the project's public (anon / publishable) key — it only works together with the login,
   because every table is closed to visitors who are not signed in. */
window.SB = (() => {
  const URL_ = 'https://dpocqkbmhqlfiudaobby.supabase.co';
  const KEY = 'sb_publishable_tz3Z-l0mhyIUz9RdxipooQ_Iij4mME-';
  const SK = 'alula_sb_session';
  const configured = !/^__/.test(KEY);
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SK) || 'null'); } catch (e) { s = null; }
  const save = () => { try { s ? localStorage.setItem(SK, JSON.stringify(s)) : localStorage.removeItem(SK); } catch (e) {} };
  const ar = () => (document.documentElement.lang || 'ar').startsWith('ar');
  const T = (a, b) => (ar() ? a : b);

  async function auth(grant, body) {
    const r = await fetch(`${URL_}/auth/v1/token?grant_type=${grant}`, { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error_description || j.msg || j.message || 'auth'); e.status = r.status; throw e; }
    s = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), user: j.user && { id: j.user.id, email: j.user.email } };
    save(); return s;
  }
  const signIn = (email, password) => auth('password', { email, password });
  let refreshing = null;
  async function token() {
    if (!s) return null;
    if (Date.now() / 1000 < s.expires_at - 60) return s.access_token;
    if (!refreshing) refreshing = auth('refresh_token', { refresh_token: s.refresh_token }).catch(e => { if (e.status === 400 || e.status === 401) { s = null; save(); } throw e; }).finally(() => { refreshing = null; });
    await refreshing; return s && s.access_token;
  }
  function signOut() {
    const t = s && s.access_token;
    if (t) fetch(`${URL_}/auth/v1/logout`, { method: 'POST', headers: { apikey: KEY, Authorization: 'Bearer ' + t } }).catch(() => {});
    s = null; save();
    document.dispatchEvent(new CustomEvent('sb:signout'));
  }
  async function rest(path, { method = 'GET', body, headers = {} } = {}) {
    const t = await token();
    if (!t) { const e = new Error('auth'); e.status = 401; throw e; }
    const r = await fetch(`${URL_}/rest/v1/${path}`, { method, headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (r.status === 401) { s = null; save(); document.dispatchEvent(new CustomEvent('sb:signout')); }
    if (!r.ok) { const j = await r.json().catch(() => ({})); const e = new Error(j.message || String(r.status)); e.status = r.status; e.code = j.code; e.details = j.details; throw e; }
    const txt = await r.text(); return txt ? JSON.parse(txt) : null;
  }
  const rpc = (fn, args) => rest('rpc/' + fn, { method: 'POST', body: args || {} });
  /* every row of a table, 1000 at a time */
  async function all(table, query) {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const page = await rest(`${table}?${query || 'select=*'}`, { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
      out.push(...page); if (page.length < 1000) return out;
    }
  }

  /* full-screen sign-in card; resolves when signed in */
  function gate(opts = {}) {
    if (s) return Promise.resolve(s);
    return new Promise(resolve => {
      const css = `.sbg{position:fixed;inset:0;z-index:9999;display:grid;place-items:center;padding:16px;background:#F8F4EF;font-family:"Cairo","Segoe UI",Tahoma,Arial,sans-serif;color:#3D3936}
.sbg form{width:100%;max-width:380px;background:#fff;border:1px solid #E7E1D8;border-radius:18px;padding:28px 24px;box-shadow:0 18px 40px -18px rgba(20,51,45,.35);display:flex;flex-direction:column;gap:14px}
.sbg .sbg-ic{width:52px;height:52px;border-radius:14px;background:#E3EAE8;color:#14332D;display:grid;place-items:center;margin:0 auto}
.sbg .sbg-ic svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.sbg h1{margin:0;text-align:center;font-size:20px;font-weight:800;color:#14332D}.sbg p{margin:-6px 0 4px;text-align:center;font-size:13.5px;color:#6E6A66}
.sbg label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:700;color:#3D3936}
.sbg input{height:44px;border:1px solid #D9D4CC;border-radius:10px;padding:0 12px;font:inherit;font-size:15px;direction:ltr;text-align:left}
.sbg input:focus{outline:none;border-color:#14332D;box-shadow:0 0 0 3px rgba(20,51,45,.15)}
.sbg button{height:46px;border:0;border-radius:10px;background:#14332D;color:#fff;font:inherit;font-size:15px;font-weight:700;cursor:pointer}
.sbg button:disabled{opacity:.6;cursor:default}.sbg .sbg-err{min-height:18px;font-size:13px;color:#B5523B;text-align:center}`;
      const el = document.createElement('div'); el.className = 'sbg'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      el.innerHTML = `<style>${css}</style><form novalidate><span class="sbg-ic"><svg viewBox="0 0 24 24"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg></span>
        <h1>${T('تسجيل الدخول', 'Sign in')}</h1><p>${opts.sub || T('بوابات مركز الزراعة — العلا', 'AlUla Agriculture Center portals')}</p>
        <label>${T('البريد الإلكتروني', 'Email')}<input name="email" type="email" autocomplete="username" required></label>
        <label>${T('كلمة المرور', 'Password')}<input name="password" type="password" autocomplete="current-password" required></label>
        <button type="submit">${T('دخول', 'Sign in')}</button><div class="sbg-err" aria-live="polite"></div></form>`;
      document.body.appendChild(el);
      const f = el.querySelector('form'), err = el.querySelector('.sbg-err'), btn = f.querySelector('button');
      setTimeout(() => f.elements.email.focus(), 50);
      f.addEventListener('submit', async e => {
        e.preventDefault(); err.textContent = ''; btn.disabled = true;
        try { await signIn(f.elements.email.value.trim(), f.elements.password.value); el.remove(); resolve(s); }
        catch (x) { err.textContent = x.status === 400 ? T('البريد أو كلمة المرور غير صحيحة', 'Wrong email or password') : T('تعذّر الاتصال — تحقق من الإنترنت', 'Cannot connect — check the internet'); }
        finally { btn.disabled = false; }
      });
    });
  }
  return { configured, signIn, signOut, rest, rpc, all, gate, get signedIn() { return !!s; }, get email() { return s && s.user && s.user.email; } };
})();
