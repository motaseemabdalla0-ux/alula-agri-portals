/**
 * السجل المركزي لبوابات مركز الزراعة — Google Apps Script
 * يخدم البوابتين من جدول Google واحد:
 *   1) مزاد تمور العلا (auction/)  — الدفعات والبائعون والمشترون
 *   2) استبيان إنتاج التمور والحمضيات (survey/)
 * كل جهاز يقرأ من هذا الجدول ويكتب فيه، فيرى الجميع نفس البيانات.
 *
 * التركيب (مرة واحدة):
 *   1. أنشئ Google Sheet جديداً ▸ Extensions ▸ Apps Script ▸ الصق هذا الملف مكان المحتوى ▸ احفظ.
 *   2. Deploy ▸ New deployment ▸ Web app ▸ Execute as: Me ▸ Who has access: Anyone ▸ Deploy ▸ وافق على الصلاحيات.
 *   3. انسخ رابط Web app (ينتهي بـ /exec) وضعه في البوابتين.
 * بعد أي تعديل على هذا الملف: Deploy ▸ Manage deployments ▸ Edit ▸ Version: New version ▸ Deploy (يبقى الرابط نفسه).
 */

// يطابق SUBMIT_KEY في ملف الاستبيان (ليس سرّاً: الرابط مفتوح بدون حماية حسب طلب المالك).
const SUBMIT_KEY = 'A_5N5xz6svy4andVnlNKP9RF';

/* ═════════ entry points ═════════ */
function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'bad_json' }); }
  try {
    switch (body.action) {
      case 'list': return out({ ok: true, records: surveyList() });
      case 'submit': return surveySubmit(body);
      case 'auction_get': return out(auctionGet(body.rev));
      case 'auction_put': return locked(() => out(auctionPut(body)));
      case 'auction_init': return locked(() => out(auctionInit(body)));
      default: return out({ ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return out({ ok: false, error: 'server', detail: String(err && err.message || err) });
  }
}

function doGet() {
  return out({ ok: true, service: 'alula-agri-portals', rev: rev() });
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function locked(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function sheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#E3EAE8');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }
  return sh;
}

function safe(v) {
  const s = v == null ? '' : String(v).slice(0, 2000);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function num(v) { return v === '' || v == null || isNaN(Number(v)) ? '' : Number(v); }

/* ═════════ auction: one sheet per kind, the full record in the last column ═════════ */
const AUCTION = {
  lots: {
    name: 'المزاد — الدفعات', prefix: 'L',
    headers: ['id', 'رقم الدفعة', 'تاريخ المزاد', 'رقم البائع', 'الصنف', 'الدرجة', 'الصناديق', 'الوزن (كجم)', 'السعر النهائي', 'القيمة', 'رقم المشتري', 'الحالة', 'آخر تحديث', 'JSON'],
    row: r => [r.id, safe(r.rid), safe(r.registrationDate), safe(r.sellerId), safe(r.dateVariety), safe(r.grade), num(r.numBoxes), num(r.weight), num(r.finalPrice), r.finalPrice && r.weight ? Number(r.finalPrice) * Number(r.weight) : '', safe(r.buyerId), safe(r.status), r.updatedAt ? new Date(r.updatedAt) : '', JSON.stringify(r)]
  },
  sellers: {
    name: 'المزاد — البائعون', prefix: 'S',
    headers: ['id', 'رقم البائع', 'الاسم', 'الجوال', 'رقم بطاقة المزارع', 'المنطقة', 'النوع', 'تاريخ التسجيل', 'آخر تحديث', 'JSON'],
    row: r => [r.id, safe(r.rid), safe(r.sellerName), safe(r.contactNumber), safe(r.farmId), safe(r.region), safe(r.sellerType), safe(r.registrationDate), r.updatedAt ? new Date(r.updatedAt) : '', JSON.stringify(r)]
  },
  buyers: {
    name: 'المزاد — المشترون', prefix: 'B',
    headers: ['id', 'رقم المشتري', 'الاسم / الشركة', 'الجوال', 'النوع', 'الدولة', 'تاريخ التسجيل', 'آخر تحديث', 'JSON'],
    row: r => [r.id, safe(r.rid), safe(r.buyerName), safe(r.mobile), safe(r.buyerType), safe(r.country), safe(r.registrationDate), r.updatedAt ? new Date(r.updatedAt) : '', JSON.stringify(r)]
  }
};

function rev() { return Number(PropertiesService.getScriptProperties().getProperty('auction_rev') || 0); }
function bump() { const n = rev() + 1; PropertiesService.getScriptProperties().setProperty('auction_rev', String(n)); return n; }

function readKind(k) {
  const c = AUCTION[k], sh = sheet(c.name, c.headers), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, c.headers.length, n, 1).getValues()
    .map(([cell]) => { try { return JSON.parse(cell); } catch (err) { return null; } })
    .filter(Boolean);
}

function auctionGet(since) {
  const r = rev();
  if (since != null && Number(since) === r && r > 0) return { ok: true, same: true, rev: r };
  const data = {};
  Object.keys(AUCTION).forEach(k => { data[k] = readKind(k); });
  return { ok: true, rev: r, data };
}

// first device to connect uploads the starting data (only when the sheets are still empty)
function auctionInit(body) {
  const empty = Object.keys(AUCTION).every(k => sheet(AUCTION[k].name, AUCTION[k].headers).getLastRow() < 2);
  if (!empty) return { ok: true, skipped: true, rev: rev() };
  Object.keys(AUCTION).forEach(k => {
    const list = (body.data && body.data[k]) || [];
    if (!list.length) return;
    const c = AUCTION[k], sh = sheet(c.name, c.headers);
    sh.getRange(2, 1, list.length, c.headers.length).setValues(list.map(c.row));
  });
  return { ok: true, rev: bump() };
}

function ridNum(r) { return parseInt(String(r || '').replace(/\D/g, ''), 10) || 0; }

function auctionPut(body) {
  const k = body.kind, c = AUCTION[k];
  if (!c) return { ok: false, error: 'kind' };
  const sh = sheet(c.name, c.headers), w = c.headers.length;
  const n = sh.getLastRow() - 1;
  const ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(x => String(x[0])) : [];
  const rids = n > 0 ? sh.getRange(2, 2, n, 1).getValues().map(x => String(x[0])) : [];
  const at = {}; ids.forEach((id, i) => { at[id] = i + 2; });
  const ridOwner = {}; rids.forEach((r, i) => { if (r) ridOwner[r] = ids[i]; });
  let max = rids.reduce((m, r) => Math.max(m, ridNum(r)), 0);
  const renamed = [], appends = [];
  (body.upserts || []).forEach(r => {
    if (!r || !r.id) return;
    // two devices took the same number at the same time: the later one gets the next free number
    if (!at[r.id] && r.rid && ridOwner[r.rid] && ridOwner[r.rid] !== r.id) {
      const old = r.rid; max += 1; r.rid = c.prefix + '-' + String(max).padStart(3, '0');
      renamed.push({ id: r.id, from: old, to: r.rid });
    }
    if (r.rid) { ridOwner[r.rid] = r.id; max = Math.max(max, ridNum(r.rid)); }
    if (at[r.id]) sh.getRange(at[r.id], 1, 1, w).setValues([c.row(r)]);
    else { appends.push(c.row(r)); at[r.id] = -1; }
  });
  if (appends.length) sh.getRange(sh.getLastRow() + 1, 1, appends.length, w).setValues(appends);
  const del = (body.deletes || []).map(String);
  if (del.length) {
    const now = sh.getLastRow() - 1;
    const cur = now > 0 ? sh.getRange(2, 1, now, 1).getValues().map(x => String(x[0])) : [];
    for (let i = cur.length - 1; i >= 0; i--) if (del.indexOf(cur[i]) >= 0) sh.deleteRow(i + 2);
  }
  return { ok: true, rev: bump(), renamed };
}

/* ═════════ survey (unchanged format, read is open) ═════════ */
const MAIN_SHEET = 'الاستبيانات';
const ITEMS_SHEET = 'الأصناف والعمليات';
const MAIN_HEADERS = ['معرف الاستبيان', 'تاريخ الاستبيان', 'وقت الحفظ', 'وقت الاستلام', 'المصدر', 'رقم المزارع (التطبيق)', 'رقم الحيازة', 'الباحث الميداني', 'اسم المزارع', 'رقم الجوال', 'المنطقة', 'خط العرض', 'خط الطول', 'رابط الموقع', 'عدد النخيل', 'إنتاج التمور (كجم)', 'قيمة التمور (ريال)', 'أصناف التمور', 'عمليات التمور', 'أشجار الحمضيات', 'إنتاج الحمضيات (كجم)', 'قيمة الحمضيات (ريال)', 'أصناف الحمضيات', 'عمليات الحمضيات', 'البيانات الكاملة (JSON)'];
const ITEM_HEADERS = ['معرف الاستبيان', 'الباحث الميداني', 'اسم المزارع', 'المنطقة', 'المحصول', 'النوع', 'الصنف / العملية', 'الكمية (كجم)', 'القيمة (ريال)'];
const JSON_COL = MAIN_HEADERS.length;

function surveySubmit(body) {
  if (body.key !== SUBMIT_KEY) return out({ ok: false, error: 'unauthorized' });
  const record = body.record, problem = check(record);
  if (problem) return out({ ok: false, error: 'invalid', detail: problem });
  locked(() => upsertSurvey(record));
  return out({ ok: true, recordId: record.recordId });
}

function check(r) {
  if (!r || typeof r !== 'object') return 'record';
  if (typeof r.recordId !== 'string' || !r.recordId || r.recordId.length > 100) return 'recordId';
  if (r.farmer != null && (typeof r.farmer !== 'string' || r.farmer.length > 200)) return 'farmer';
  if (r.source !== 'farmer-app' && !(r.farmer || '').trim()) return 'farmer';
  if (!Array.isArray(r.varieties) || !Array.isArray(r.operations)) return 'items';
  if (r.varieties.length > 100 || r.operations.length > 100) return 'items';
  if (r.citrus != null && (typeof r.citrus !== 'object' || !Array.isArray(r.citrus.varieties) || !Array.isArray(r.citrus.operations))) return 'citrus';
  if (r.citrus && (r.citrus.varieties.length > 100 || r.citrus.operations.length > 100)) return 'citrus';
  if (JSON.stringify(r).length > 45000) return 'size';
  return '';
}

function itemName(i) { return i.choice === 'أخرى' ? (i.custom || 'أخرى') : i.choice; }
function regionOf(r) { return r.region === 'أخرى' ? (r.regionOther || 'أخرى') : r.region; }
function productionOf(r) {
  if (r.production !== '' && r.production != null) return num(r.production);
  return r.varieties.reduce((n, v) => n + (Number(v.quantity) || 0), 0);
}
function filled(list) { return list.filter(i => i && (i.choice || i.quantity)); }

function upsertSurvey(r) {
  const main = sheet(MAIN_SHEET, MAIN_HEADERS), items = sheet(ITEMS_SHEET, ITEM_HEADERS);
  const text = list => filled(list).map(i => itemName(i) + ' ' + (i.quantity || '') + ' كجم' + (i.value ? ' / ' + i.value + ' ريال' : '')).join('، ');
  const c = r.citrus || { trees: '', production: '', productionValue: '', varieties: [], operations: [] };
  const loc = r.location && isFinite(Number(r.location.lat)) && isFinite(Number(r.location.lng)) ? r.location : null;
  const row = [
    safe(r.recordId), safe(r.surveyDate), safe(r.savedAt), new Date(), r.source === 'farmer-app' ? 'تطبيق المزارع' : 'الباحث الميداني', safe(r.farmerId), safe(r.holding), safe(r.collector), safe(r.farmer), safe(r.phone),
    safe(regionOf(r)), loc ? num(loc.lat) : '', loc ? num(loc.lng) : '', loc ? 'https://www.google.com/maps?q=' + Number(loc.lat) + ',' + Number(loc.lng) : '', num(r.trees), productionOf(r), num(r.productionValue), safe(text(r.varieties)), safe(text(r.operations)),
    num(c.trees), num(c.production), num(c.productionValue), safe(text(c.varieties)), safe(text(c.operations)), JSON.stringify(r)
  ];
  const existing = findRows(main, r.recordId);
  if (existing.length) main.getRange(existing[0], 1, 1, row.length).setValues([row]);
  else main.appendRow(row);
  findRows(items, r.recordId).reverse().forEach(n => items.deleteRow(n));
  const base = [safe(r.recordId), safe(r.collector), safe(r.farmer), safe(regionOf(r))], rows = [];
  filled(r.varieties).forEach(v => rows.push(base.concat(['التمور', 'صنف', safe(itemName(v)), num(v.quantity), num(v.value)])));
  filled(r.operations).forEach(o => rows.push(base.concat(['التمور', 'عملية', safe(itemName(o)), num(o.quantity), num(o.value)])));
  filled(c.varieties).forEach(v => rows.push(base.concat(['الحمضيات', 'صنف', safe(itemName(v)), num(v.quantity), num(v.value)])));
  filled(c.operations).forEach(o => rows.push(base.concat(['الحمضيات', 'عملية', safe(itemName(o)), num(o.quantity), num(o.value)])));
  if (rows.length) items.getRange(items.getLastRow() + 1, 1, rows.length, ITEM_HEADERS.length).setValues(rows);
}

function findRows(sh, id) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const ids = sh.getRange(2, 1, n, 1).getValues(), found = [];
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) found.push(i + 2);
  return found;
}

function surveyList() {
  const sh = sheet(MAIN_SHEET, MAIN_HEADERS), n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, JSON_COL, n, 1).getValues()
    .map(([cell]) => { try { return JSON.parse(cell); } catch (err) { return null; } })
    .filter(Boolean);
}
