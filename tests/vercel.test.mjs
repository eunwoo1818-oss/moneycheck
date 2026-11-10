import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Vercel에서는 저장소 미연결 시에도 화면을 제공하고 임시 DB를 생성하지 않는다', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'moneycheck-vercel-'));
  const file = join(dir, 'must-not-be-created.sqlite');
  const port = 33180;
  const child = spawn(process.execPath, ['tests/fixtures/vercel-server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, VERCEL: '1', PORT: String(port), HOST: '127.0.0.1', DATABASE_PATH: file, DATABASE_URL:'',POSTGRES_URL:'' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill();
      await exited;
    }
    await rm(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('서버 시작 시간 초과')), 10000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', chunk => {
      if (String(chunk).includes('머니체크 실행')) { clearTimeout(timer); resolve(); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`서버 종료: ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /머니체크/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  const status = await fetch(base + '/api/status');
  assert.equal(status.status, 503);
  assert.match((await status.json()).error, /영구 데이터 저장소/);
  assert.equal((await fetch(base)).status, 200);
  await assert.rejects(access(file), { code: 'ENOENT' });
});
