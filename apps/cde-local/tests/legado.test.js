// Ligado ao SmartEasyWEB, a página e a API antigas do CDE local ficam desativadas; /api/v2 continua.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');

test('interface antiga desativada quando ligado ao SmartEasyWEB', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-legado-'));
  const web = fs.mkdtempSync(path.join(os.tmpdir(), 'cde-web-'));
  fs.writeFileSync(path.join(web, 'index.html'), '<div id="root"></div>');
  const { app, db } = await createApp({ dataDir: dir, webDir: web });
  const srv = app.listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    // Sem ligação: tudo como antes.
    assert.match(await (await fetch(base + '/')).text(), /id="root"/);
    assert.strictEqual((await (await fetch(base + '/api/status')).json()).legado, true);
    // Ligado (grava a chave como o /api/v2/ligar faria).
    const { publicKey } = require('node:crypto').generateKeyPairSync('ed25519');
    db.setting('gestao_url', 'http://smarteasyweb.local');
    db.setting('gestao_chave', publicKey.export({ type: 'spki', format: 'pem' }));
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /ligado ao SmartEasyWEB/);
    assert.match(page, /href="http:\/\/smarteasyweb.local"/);
    const r = await fetch(base + '/api/empreendimentos');
    assert.strictEqual(r.status, 410);
    assert.strictEqual((await r.json()).smarteasyweb, 'http://smarteasyweb.local');
    const st = await (await fetch(base + '/api/status')).json();
    assert.strictEqual(st.legado, false);
    assert.strictEqual(st.smarteasyweb, 'http://smarteasyweb.local');
    assert.strictEqual((await fetch(base + '/api/v2/status')).status, 200);
  } finally {
    srv.close();
  }
});
