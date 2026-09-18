/**
 * Track n Trade — sync backend (Google Apps Script, bound to one Google Sheet).
 *
 * Receives one POST per lot from the app and appends it to a tab:
 *   - kind "lot"    → tab "lots"   (paid team sync; keyed by licence code)
 *   - kind "market" → tab "market" (free tier; anonymised market rows, no identifiers)
 *
 * Deploy as a Web app: Execute as "Me", Who has access "Anyone". Then paste the
 * web app URL into SYNC_ENDPOINT_URL in the app, and the same SECRET into SYNC_SECRET.
 */

var SECRET = 'change-me-to-a-long-random-string';   // must match SYNC_SECRET in the app

var LOT_COLS = ['received', 'code', 'id', 't', 'sale', 'yard', 'pen', 'hd', 'wt', 'priceHd', 'priceKg', 'total',
                'agent', 'client', 'sent', 'carrier', 'desc', 'sex', 'note', 'docket'];
var MARKET_COLS = ['received', 'dev', 'day', 'hour', 'yard', 'yardHow', 'hd', 'wt', 'price', 'unit', 'sex', 'marks', 'mode', 'appVersion'];

function doGet() {
  return ContentService.createTextOutput('Track n Trade sync: ok').setMimeType(ContentService.MimeType.TEXT);
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
    else upsertLot_(body);
  } finally {
    lock.releaseLock();
  }
  return out.setContent('ok');
}

/* One row per anonymised lot. Nothing identifying is accepted even if sent:
   only the columns listed in MARKET_COLS are written. */
function appendRow_(tabName, cols, body) {
  var sh = sheet_(tabName, cols);
  var row = cols.map(function (c) { return c === 'received' ? new Date() : (body[c] == null ? '' : body[c]); });
  sh.appendRow(row);
}

/* Paid sync: same lot (code + id) sent again after an edit updates its row instead of duplicating it. */
function upsertLot_(body) {
  if (!body.code) return;
  var sh = sheet_('lots', LOT_COLS);
  var codeCol = LOT_COLS.indexOf('code') + 1, idCol = LOT_COLS.indexOf('id') + 1;
  var last = sh.getLastRow();
  var rowIndex = 0;
  if (last > 1) {
    var codes = sh.getRange(2, codeCol, last - 1, 1).getValues();
    var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i][0]) === String(body.code) && String(ids[i][0]) === String(body.id)) { rowIndex = i + 2; break; }
    }
  }
  var row = LOT_COLS.map(function (c) { return c === 'received' ? new Date() : (body[c] == null ? '' : body[c]); });
  if (rowIndex) sh.getRange(rowIndex, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

function sheet_(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); }
  if (sh.getLastRow() === 0) { sh.appendRow(cols); sh.setFrozenRows(1); }
  return sh;
}
