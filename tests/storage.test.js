// Cloudinary storage without a network connection: the SDK's upload/destroy and Cloudinary's
// download endpoint are replaced by stubs, so we test our keys, links and private-file route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.NODE_ENV = 'test';
process.env.STORAGE_DRIVER = 'cloudinary';
process.env.CLOUDINARY_URL = 'cloudinary://123456:secretsecret@demo-cloud';
process.env.CLOUDINARY_FOLDER = 'autodealer';
process.env.PUBLIC_URL = 'http://api.test';

const { v2: cloudinary } = await import('cloudinary');
const storage = await import('../src/services/storage.js');
const { createApp } = await import('../src/app.js');

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 test').toString('base64')}`;
const calls = { upload: [], destroy: [] };
let server;
let base;
const realFetch = globalThis.fetch;

before(async () => {
  cloudinary.uploader.upload = async (data, opts) => {
    calls.upload.push(opts);
    return { public_id: `${opts.folder}/${opts.public_id}`, format: data.startsWith('data:application/pdf') ? 'pdf' : 'png', resource_type: opts.resource_type, type: opts.type };
  };
  cloudinary.uploader.destroy = async (id, opts) => {
    calls.destroy.push({ id, ...opts });
    return { result: 'ok' };
  };
  // Cloudinary's private download API → a fake PDF; everything else goes to the real fetch (our test server).
  globalThis.fetch = async (url, init) => (String(url).startsWith('https://api.cloudinary.com/') ? new Response('%PDF-1.4 test', { status: 200, headers: { 'content-type': 'application/pdf' } }) : realFetch(url, init));
  server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  globalThis.fetch = realFetch;
  server?.close();
});

test('photos go to Cloudinary and are served from its CDN', async () => {
  const key = await storage.saveDataUrl(PNG, 'photos');
  assert.match(key, /^cld:image\/upload\/autodealer\/photos\/[0-9a-f-]{36}\.png$/);
  assert.equal(calls.upload.at(-1).type, 'upload');
  assert.equal(calls.upload.at(-1).folder, 'autodealer/photos');
  const url = storage.fileUrl(key);
  assert.match(url, /^https:\/\/res\.cloudinary\.com\/demo-cloud\/image\/upload\/f_auto,q_auto\/autodealer\/photos\/.+\.png$/);
  // When a seller edits a listing the website sends the link back: it maps to the same key.
  assert.equal(storage.keyFromUrl(url), key);
  assert.equal(storage.isOwnFile(key), true);
  await storage.removeFile(key);
  assert.deepEqual(calls.destroy.at(-1), { id: key.replace(/^cld:image\/upload\//, '').replace(/\.png$/, ''), resource_type: 'image', type: 'upload', invalidate: true });
});

test('documents are private: authenticated on Cloudinary, expiring links through the API', async () => {
  const key = await storage.saveDataUrl(PDF, 'docs');
  assert.match(key, /^cld:image\/authenticated\/autodealer\/docs\/.+\.pdf$/);
  assert.equal(calls.upload.at(-1).type, 'authenticated');
  const url = storage.fileUrl(key, 60);
  assert.match(url, /^http:\/\/api\.test\/files\/c\/[\w-]+\?exp=\d+&sig=[\w-]+$/);
  assert.ok(!url.includes('cloudinary'), 'the Cloudinary address is never handed out');

  const local = url.replace('http://api.test', base);
  const ok = await fetch(local);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('content-type'), 'application/pdf');
  assert.equal(await ok.text(), '%PDF-1.4 test');

  const tampered = await fetch(local.replace(/sig=[\w-]+/, 'sig=bad'));
  assert.equal(tampered.status, 403);
  const expired = storage.fileUrl(key, -10).replace('http://api.test', base);
  assert.equal((await fetch(expired)).status, 403);
});

test('wrong file types are refused before uploading', async () => {
  const n = calls.upload.length;
  await assert.rejects(storage.saveDataUrl('data:text/html;base64,PGgxPmhpPC9oMT4=', 'photos'), /aren't accepted/);
  assert.equal(calls.upload.length, n);
});
