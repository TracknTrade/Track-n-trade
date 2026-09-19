/**
 * Track n Trade — sync backend v3 (Google Apps Script, bound to one Google Sheet).
 *
 * POST, one JSON body per call (all carry k = SECRET):
 *   kind "lot"      → tab "lots"      paid; one row per lot keyed by code + id (edits/deletes update the row)
 *   kind "settings" → tab "settings"  paid; one row per code, replaced on every change
 *   kind "market"   → tab "market"    free tier; anonymised market rows, no identifiers
 *   kind "lead"     → tab "leads"     email left on the first-open terms screen, with consent flag
 * GET ?k=&code=                       → {ok, lots, settings} for Restore on a new phone
 * GET ?k=&code=&act=1&dev=&mobile=&name=&ver=
 *                                     → activation / weekly re-check: {ok, plan, seats, seatsUsed, addons, expires, reason}
 *
 * Tabs you edit by hand:
 *   licences  — code | plan | seats | addons | expires | active | notes      (one row per licence sold)
 * Tabs the script writes:
 *   activations — code | dev | mobile | name | first | last | appVersion    (one row per device per code)
 *
 * Deploy as a Web app: Execute as "Me", Who has access "Anyone". Paste the web app URL into
 * SYNC_ENDPOINT_URL in the app and the same SECRET into SYNC_SECRET.
 */

var SECRET = 'change-me-to-a-long-random-string';   // must match SYNC_SECRET in the app

var LOT_COLS = ['received', 'code', 'id', 'saleId', 't', 'sale', 'yard', 'pen', 'hd', 'wt', 'priceHd', 'priceKg', 'total',
                'agent', 'client', 'sent', 'carrier', 'desc', 'sex', 'note', 'docket', 'deleted', 'raw'];
var SETTINGS_COLS = ['received', 'code', 'device', 'json'];
var MARKET_COLS = ['received', 'dev', 'day', 'hour', 'yard', 'yardHow', 'hd', 'wt', 'price', 'unit', 'sex', 'marks', 'mode', 'appVersion'];
var LEAD_COLS = ['received', 'email', 'consent', 'dev', 'appVersion'];
var LIC_COLS = ['code', 'plan', 'seats', 'addons', 'expires', 'active', 'notes'];
var ACT_COLS = ['code', 'dev', 'mobile', 'name', 'first', 'last', 'appVersion'];

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!p.code) {
    return ContentService.createTextOutput('Track n Trade sync: ok').setMimeType(ContentService.MimeType.TEXT);
  }
  var out = { ok: false };
  if (p.k === SECRET) {
    if (p.act) out = activate_(p);
    else out = { ok: true, lots: lotsForCode_(String(p.code)), settings: settingsForCode_(String(p.code)) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var out = ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
  var body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out.setContent('bad json'); }
  if (!body || body.k !== SECRET) return out.setContent('denied');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (body.kind === 'market') appendRow_('market', MARKET_COLS, body);
    else if (body.kind === 'lead') appendRow_('leads', LEAD_COLS, body);
    else if (body.kind === 'settings') upsertByCode_('settings', SETTINGS_COLS, body);
    else upsertLot_(body);
  } finally {
    lock.releaseLock();
  }
  return out.setContent('ok');
}

/* ── Activation: what plan is this code on, and is there a seat for this device? ──
   The block is at the door: a device over the cap gets plan 'free' and a reason; a device already
   registered against the code always gets back in (phone upgrades re-register under the same mobile). */
function activate_(p) {
  var code = String(p.code || '').trim().toUpperCase();
  var dev = String(p.dev || '');
  var lic = licence_(code);
  if (!lic || String(lic.active).toLowerCase() === 'no' || String(lic.active).toLowerCase() === 'false') {
    return { ok: true, plan: 'free', reason: 'unknown' };
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = sheet_('activations', ACT_COLS);
    var rows = rowsFor_(sh, ACT_COLS);
    var mine = rows.filter(function (r) { return String(r.code).toUpperCase() === code; });
    var seatsUsed = 0, seen = {};
    mine.forEach(function (r) { var key = r.mobile ? ('m:' + r.mobile) : ('d:' + r.dev); if (!seen[key]) { seen[key] = 1; seatsUsed++; } });
    var already = mine.filter(function (r) { return r.dev === dev || (p.mobile && r.mobile && r.mobile === p.mobile); });
    var seats = parseInt(lic.seats, 10) || 1;
    if (!already.length && seatsUsed >= seats) {
      return { ok: true, plan: 'free', reason: 'seats', seats: seats, seatsUsed: seatsUsed };
    }
    var now = new Date();
    if (already.length) {
      already.forEach(function (r) { sh.getRange(r._row, ACT_COLS.indexOf('last') + 1).setValue(now); sh.getRange(r._row, ACT_COLS.indexOf('appVersion') + 1).setValue(p.ver || ''); if (p.mobile && !r.mobile) sh.getRange(r._row, ACT_COLS.indexOf('mobile') + 1).setValue(p.mobile); });
    } else {
      sh.appendRow([code, dev, p.mobile || '', p.name || '', now, now, p.ver || '']);
      seatsUsed++;
    }
    return {
      ok: true, plan: String(lic.plan || 'solo'), seats: seats, seatsUsed: seatsUsed,
      addons: String(lic.addons || '').split(/[,\s]+/).filter(Boolean),
      expires: lic.expires ? Utilities.formatDate(new Date(lic.expires), Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''
    };
  } finally {
    lock.releaseLock();
  }
}
function licence_(code) {
  var sh = sheet_('licences', LIC_COLS);
  var rows = rowsFor_(sh, LIC_COLS);
  for (var i = 0; i < rows.length; i++) if (String(rows[i].code).trim().toUpperCase() === code) return rows[i];
  return null;
}
function rowsFor_(sh, cols) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return vals.map(function (v, i) { var o = { _row: i + 2 }; cols.forEach(function (c, j) { o[c] = v[j]; }); return o; });
}

/* One row per anonymised lot (or lead). Only the listed columns are written, whatever else is sent. */
function appendRow_(tabName, cols, body) {
  var sh = sheet_(tabName, cols);
  sh.appendRow(rowFor_(cols, body));
}

/* Paid sync: the same lot (code + id) sent again after an edit or delete updates its row. */
function upsertLot_(body) {
  if (!body.code) return;
  var sh = sheet_('lots', LOT_COLS);
  var codeCol = LOT_COLS.indexOf('code') + 1, idCol = LOT_COLS.indexOf('id') + 1;
  var rowIndex = findRow_(sh, codeCol, String(body.code), idCol, String(body.id));
  var row = rowFor_(LOT_COLS, body);
  if (rowIndex) sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}
function upsertByCode_(tabName, cols, body) {
  if (!body.code) return;
  var sh = sheet_(tabName, cols);
  var codeCol = cols.indexOf('code') + 1;
  var rowIndex = findRow_(sh, codeCol, String(body.code));
  var row = rowFor_(cols, body);
  if (rowIndex) sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}
function lotsForCode_(code) {
  var sh = sheet_('lots', LOT_COLS);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, LOT_COLS.length).getValues();
  var codeI = LOT_COLS.indexOf('code'), rawI = LOT_COLS.indexOf('raw'), delI = LOT_COLS.indexOf('deleted');
  var out = [];
  vals.forEach(function (r) {
    if (String(r[codeI]) !== code || String(r[delI]) === 'true' || r[delI] === true) return;
    try { if (r[rawI]) out.push(JSON.parse(r[rawI])); } catch (err) {}
  });
  return out;
}
function settingsForCode_(code) {
  var sh = sheet_('settings', SETTINGS_COLS);
  var codeCol = SETTINGS_COLS.indexOf('code') + 1;
  var rowIndex = findRow_(sh, codeCol, code);
  if (!rowIndex) return null;
  var json = sh.getRange(rowIndex, SETTINGS_COLS.indexOf('json') + 1).getValue();
  try { return JSON.parse(json); } catch (err) { return null; }
}
function findRow_(sh, col1, val1, col2, val2) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var a = sh.getRange(2, col1, last - 1, 1).getValues();
  var b = col2 ? sh.getRange(2, col2, last - 1, 1).getValues() : null;
  for (var i = 0; i < a.length; i++) {
    if (String(a[i][0]) === val1 && (!b || String(b[i][0]) === val2)) return i + 2;
  }
  return 0;
}
function rowFor_(cols, body) {
  return cols.map(function (c) {
    if (c === 'received') return new Date();
    var v = body[c];
    if (v == null) return '';
    return (typeof v === 'object') ? JSON.stringify(v) : v;
  });
}
function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) { sh.appendRow(cols); sh.setFrozenRows(1); }
  return sh;
}
