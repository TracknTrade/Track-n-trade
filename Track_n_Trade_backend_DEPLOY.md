# Track n Trade — backend deploy (about 10 minutes)

You need: a Google account the sheet will live under. Nothing else.

## 1. Make the sheet
1. Go to sheets.google.com → Blank spreadsheet. Name it **Track n Trade sync**.
2. Menu **Extensions → Apps Script**. A code editor opens with an empty `Code.gs`.
3. Delete everything in it and paste the contents of `Code.gs` from this folder.
4. On the line `var SECRET = 'change-me-to-a-long-random-string';` replace the text between the quotes with a long random string (20+ letters and numbers, no spaces). Keep a copy — you'll give it to me.
5. Click the **Save** icon (disk).

## 2. Deploy it as a web app
1. Top right: **Deploy → New deployment**.
2. Click the gear next to "Select type" → **Web app**.
3. Description: `v1`. **Execute as: Me**. **Who has access: Anyone**. (Anyone means the phones can reach it; the secret is what stops anyone else writing to it.)
4. **Deploy**. Google will ask you to authorise — choose your account, click **Advanced → Go to Track n Trade sync (unsafe)** if it warns (it's your own script), then **Allow**.
5. Copy the **Web app URL** (ends in `/exec`).

## 3. Test it
Open the Web app URL in a browser tab. It should show `Track n Trade sync: ok`.

## 4. Hand over
Send me two things:
- the Web app URL
- the SECRET string

I put them into `SYNC_ENDPOINT_URL` and `SYNC_SECRET` in the app and ship the version. From then on:
- free phones (no licence code) send anonymised market rows → **market** tab
- licensed phones send full lots → **lots** tab (one row per lot; edits and deletes update the row) and their settings → **settings** tab (one row per licence code)
- a licensed phone can **Restore from licence** (Setup → Team sync) — it reads everything under its code back down. That's the paid tier's backup.

The tabs create themselves with headers on the first row received.

## Test the restore read
Open `<Web app URL>?code=TEST&k=<your SECRET>` in a browser. You should see `{"ok":true,"lots":[],"settings":null}`. Wrong secret shows `{"ok":false}`.

## Changing the script later
Edit the code → **Deploy → Manage deployments → pencil icon → Version: New version → Deploy**. The URL stays the same. If you only click Save without a new deployment, the phones keep hitting the old code.
