import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient, validatePublicUrl, validateImage } from '../plugins/atx-assistant/server/core.mjs';

const key = 'secret-api-key-123';
const image = 'data:image/png;base64,aGVsbG8=';
const json = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, ...init });
const client = (fetchImpl, extra = {}) => createClient({ getApiKey: () => key, fetchImpl, ...extra });
const ref = url => ({ type: 'image_url', image_url: { url } });

test('public catalog is GET without authorization or a request body', async () => {
  const api = createClient({ getApiKey: () => { assert.fail('public catalog must not resolve key'); }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.aitransx.com/v1/models');
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(options.body, undefined);
    return json({ data: [{ id: 'openai/gpt-image-2' }] });
  } });
  assert.equal((await api.listModels()).data[0].id, 'openai/gpt-image-2');
});

test('request shapes, defaults, authorization, raw response, no retry', async () => {
  const calls = [];
  const api = client(async (url, options) => { calls.push({ url, ...options, body: JSON.parse(options.body) }); return json({ untouched: ['result'] }); });
  assert.deepEqual(await api.search({ query: 'search' }), { untouched: ['result'] });
  await api.fetchPage({ url: 'https://example.com/page?q=1' });
  await api.generate({ model: 'image-model', prompt: 'draw' });
  await api.generate({ model: 'image-model', prompt: 'edit', references: [image] });
  await api.recognize({ model: 'vision-model', prompt: 'describe', images: [image, 'https://example.com/image.png'] });
  assert.equal(calls.length, 5);
  assert.equal(calls[0].url, 'https://api.aitransx.com/v1/tools/search');
  assert.deepEqual(calls[0].body, { query: 'search', count: 5, need_content: true });
  assert.deepEqual(calls[1].body, { url: 'https://example.com/page?q=1' });
  assert.deepEqual(calls[2].body, { model: 'image-model', prompt: 'draw', size: '1024x1024', response_format: 'b64_json' });
  assert.deepEqual(calls[3].body.input_references, [ref(image)]);
  assert.deepEqual(calls[4].body, { model: 'vision-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'describe' }, ref(image), ref('https://example.com/image.png')] }], stream: false });
  for (const call of calls) {
    assert.equal(call.method, 'POST'); assert.equal(call.redirect, 'error');
    assert.equal(call.headers.Authorization, `Bearer ${key}`);
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.ok(call.signal instanceof AbortSignal);
  }
});

test('base URL and API paths cannot leak authorization', async () => {
  for (const baseUrl of ['http://example.com', 'https://u:p@example.com', 'https://example.com?a=1', 'https://example.com#x', 'https://example.com?', 'https://example.com/#']) {
    assert.throws(() => client(() => {}, { baseUrl }), /HTTPS|query|fragment/);
  }
  const api = client(() => { throw Error('must not call'); });
  for (const path of ['//evil.com', '/tools/../search', '/tools/search?x=1', 'https://evil.com', '/tools\\search']) {
    await assert.rejects(api.post(path, {}), /Invalid API path/);
  }
});

test('public HTTPS validation blocks local/private and URL obfuscations', () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://localhost', 'https://x.localhost', 'https://internal', 'https://127.0.0.1', 'https://127.1', 'https://2130706433', 'https://0x7f000001', 'https://10.1.2.3', 'https://172.16.1.1', 'https://192.168.1.1', 'https://169.254.169.254', 'https://100.64.0.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[fc00::1]', 'https://[fe80::1]', 'https://example.com\\@localhost']) {
    assert.throws(() => validatePublicUrl(url), { name: 'ValidationError' }, url);
  }
  for (const url of ['https://example.com/path?a=1', 'https://8.8.8.8', 'https://[2606:4700:4700::1111]/']) assert.equal(validatePublicUrl(url), url);
});

test('image validation rejects unsupported, malformed and oversized input', () => {
  for (const value of [null, '', 'data:image/gif;base64,aGVsbG8=', 'data:image/svg+xml;base64,aGVsbG8=', 'data:image/png;base64,abc', 'data:image/png;base64,ab==', 'data:image/png;base64,', 'https://127.0.0.1/a']) {
    assert.throws(() => validateImage(value), { name: 'ValidationError' });
  }
  for (const mime of ['png', 'jpeg', 'webp']) assert.equal(validateImage(`data:image/${mime};base64,aGVsbG8=`), `data:image/${mime};base64,aGVsbG8=`);
  const exact = `data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024).toString('base64')}`;
  assert.equal(validateImage(exact), exact);
  assert.throws(() => validateImage(`data:image/png;base64,${Buffer.alloc(4 * 1024 * 1024 + 1).toString('base64')}`), /4 MiB/);
});

test('input checks run without calling fetch', () => {
  const api = client(() => { assert.fail('network must not be called'); });
  for (const query of ['', ' ', 'x'.repeat(129), null]) assert.throws(() => api.search({ query }));
  for (const count of [0, 11, 1.5, '5']) assert.throws(() => api.search({ query: 'ok', count }));
  assert.throws(() => api.fetchPage({ url: 'https://localhost' }));
  assert.throws(() => api.generate({ model: '', prompt: 'ok' }));
  assert.throws(() => api.generate({ model: 'ok', prompt: 'ok', references: ['https://10.0.0.1'] }));
  assert.throws(() => api.recognize({ model: 'ok', prompt: 'ok', images: [] }));
});

test('cancellation and timeout discard unsafe reasons, even with uncooperative fetch', async () => {
  const api = client(() => new Promise(() => {}), { timeoutMs: 20 });
  const pre = new AbortController(); pre.abort(Error(key));
  await assert.rejects(api.post('/tools/search', {}, pre.signal), e => e.name === 'AbortError' && !String(e).includes(key));
  const controller = new AbortController();
  const pending = api.post('/tools/search', {}, controller.signal);
  controller.abort(Error(key));
  await assert.rejects(pending, { name: 'AbortError' });
  // AbortSignal.timeout is unref'ed, so retain a test-only handle while awaiting it.
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(api.post('/tools/search', {}), { name: 'TimeoutError' }); }
  finally { clearInterval(keepAlive); }
});

test('timeout also interrupts a stalled response stream', async () => {
  const api = client(async () => new Response(new ReadableStream({ start() {} })), { timeoutMs: 20 });
  const keepAlive = setInterval(() => {}, 1000);
  try { await assert.rejects(api.post('/tools/search', {}), { name: 'TimeoutError' }); }
  finally { clearInterval(keepAlive); }
});

test('stream byte limits apply to ordinary and image JSON; content length not trusted', async () => {
  let cancelled = false;
  const api = client(async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024)); controller.enqueue(new Uint8Array(1)); },
    cancel() { cancelled = true; },
  }), { headers: { 'content-length': '1' } }));
  await assert.rejects(api.post('/tools/search', {}), { name: 'ResponseLimitError' });
  assert.equal(cancelled, true);
  const large = 'x'.repeat(2 * 1024 * 1024);
  const imageApi = client(async () => json({ data: large }));
  assert.equal((await imageApi.generate({ model: 'm', prompt: 'p' })).data.length, large.length);
  const maxApi = client(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(32 * 1024 * 1024 + 1)); } })));
  await assert.rejects(maxApi.generate({ model: 'm', prompt: 'p' }), { name: 'ResponseLimitError' });
  const declaredApi = client(async () => new Response('{}', { headers: { 'content-length': String(33 * 1024 * 1024) } }));
  await assert.rejects(declaredApi.generate({ model: 'm', prompt: 'p' }), { name: 'ResponseLimitError' });
});

test('HTTP errors expose only safe metadata, never provider message/key/request body; no retries', async () => {
  let calls = 0;
  const api = client(async () => { calls++; return json({ error: { code: 'quota_exceeded', message: `${key}: private prompt` } }, { status: 429, headers: { 'x-request-id': 'req_123' } }); });
  await assert.rejects(api.post('/images/generations', { prompt: 'private prompt' }), e => {
    assert.equal(e.status, 429); assert.equal(e.code, 'quota_exceeded'); assert.equal(e.requestId, 'req_123');
    assert.ok(!String(e).includes(key)); assert.ok(!String(e).includes('private prompt')); return true;
  });
  assert.equal(calls, 1);
  const unsafe = client(async () => json({ error: { code: key, message: key } }, { status: 500, headers: { 'x-request-id': key } }));
  await assert.rejects(unsafe.post('/tools/search', {}), e => !String(e).includes(key) && !e.code && !e.requestId);
  const network = client(async () => { throw Error(`network ${key}`); });
  await assert.rejects(network.post('/tools/search', {}), e => e.name === 'NetworkError' && !String(e).includes(key));
  const invalid = client(async () => new Response(key));
  await assert.rejects(invalid.post('/tools/search', {}), e => e.name === 'ResponseError' && !String(e).includes(key));
});

test('redirects are refused and not followed', async () => {
  let calls = 0;
  const api = client(async (_, options) => { calls++; assert.equal(options.redirect, 'error'); return new Response(null, { status: 302, headers: { location: `https://evil.example/${key}` } }); });
  await assert.rejects(api.post('/tools/search', {}), e => e.status === 302 && !String(e).includes(key));
  assert.equal(calls, 1);
  const redirected = client(async () => ({ redirected: true, status: 200, body: null }));
  await assert.rejects(redirected.post('/tools/search', {}), /redirect refused/);
});
