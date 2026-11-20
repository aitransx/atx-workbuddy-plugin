import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '../plugins/atx-assistant/server/core.mjs';
import { decodeImage, imageInput, sniffImage, saveImage } from '../plugins/atx-assistant/server/images.mjs';
import { createCatalog } from '../plugins/atx-assistant/server/catalog.mjs';
import { mediaTools } from '../plugins/atx-assistant/server/tools-media.mjs';

const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const response = bytes => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }));

function harness(dir, bytes = gif, hook) {
  const calls = [];
  const client = createClient({ getApiKey: () => 'test-key', fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return response(bytes);
  } });
  const catalog = createCatalog({ refreshHours: 0, models: [{ id: 'confirmed-animation', gif: true }, { id: 'still', image: true }] });
  const tool = mediaTools({ client, catalog, settings: () => ({ imageEnabled: true, gifModel: 'confirmed-animation', imageModel: 'still' }),
    cwd: () => dir, outputDir: () => dir, ...(hook ? { resolveMediaModel: hook } : {}) }).find(t => t.name === 'atx_generate_image');
  return { client, calls, tool };
}

async function temporary(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'atx-gif-'));
  try { await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('GIF 请求携带协议字段，保存原始 GIF 字节，仅发送一次', () => temporary(async dir => {
  const { tool, calls } = harness(dir);
  const result = await tool.run({ prompt: '明确要求 GIF 动图', outputFormat: 'gif', frameCount: 9, frameDurationMs: 200 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api-hk.aitransx.com/v1/images/generations');
  assert.deepEqual(calls[0].body, { model: 'confirmed-animation', prompt: '明确要求 GIF 动图', size: 'auto', response_format: 'b64_json', output_format: 'gif', frame_count: 9, frame_duration_ms: 200 });
  assert.match(result.path, /\.gif$/);
  assert.deepEqual(await readFile(result.path), gif);
}));

test('GIF87a 和 GIF89a 可解码保存，输入仍拒绝 GIF', () => temporary(async dir => {
  for (const signature of ['GIF87a', 'GIF89a']) {
    const bytes = Buffer.from(gif);
    bytes.write(signature);
    const decoded = decodeImage(bytes.toString('base64'));
    assert.equal(decoded.mediaType, 'image/gif');
    assert.deepEqual(await readFile(await saveImage(decoded.data, decoded.mediaType, dir)), bytes);
    assert.throws(() => sniffImage(bytes));
    const path = join(dir, `${signature}.gif`);
    await writeFile(path, bytes);
    await assert.rejects(imageInput(path), /PNG/);
    await assert.rejects(imageInput(`data:image/gif;base64,${bytes.toString('base64')}`), /PNG/);
  }
}));

test('错误帧参数在模型解析和请求前拒绝', () => temporary(async dir => {
  let resolutions = 0;
  const { tool, calls, client } = harness(dir, gif, () => { resolutions++; return 'confirmed-animation'; });
  for (const args of [{ frameCount: 0 }, { frameCount: 17 }, { frameCount: 1.5 }, { frameCount: '9' },
    { frameDurationMs: 0 }, { frameDurationMs: -1 }, { frameDurationMs: 1.2 }, { frameDurationMs: Infinity }]) {
    await assert.rejects(tool.run({ prompt: '动图', outputFormat: 'gif', ...args }));
  }
  await assert.rejects(tool.run({ prompt: '静态图', frameCount: 9 }));
  await assert.rejects(tool.run({ prompt: '静态图', frameDurationMs: 200 }));
  await assert.rejects(tool.run({ prompt: '静态图', outputFormat: 'jpeg' }));
  for (const args of [{ frame_count: 17 }, { frame_duration_ms: 0 }, { output_format: 'png', frame_count: 9 }, { output_format: 'webp' }]) {
    assert.throws(() => client.generate({ model: 'confirmed-animation', prompt: '动图', output_format: 'gif', ...args }));
  }
  assert.equal(resolutions, 0);
  assert.equal(calls.length, 0);
}));

test('GIF 请求返回 PNG 或 URL 时拒绝，不保存或重试', () => temporary(async dir => {
  const { tool, calls } = harness(dir, png);
  await assert.rejects(tool.run({ prompt: '动图', outputFormat: 'gif' }), /未返回 GIF/);
  assert.equal(calls.length, 1);
  assert.deepEqual(await readdir(dir), []);
  const urlTool = mediaTools({ settings: () => ({ imageEnabled: true }), resolveMediaModel: () => 'confirmed-animation',
    client: { generate: async () => ({ data: [{ url: 'https://example.com/image.gif' }] }) }, cwd: () => dir, outputDir: () => dir })[0];
  await assert.rejects(urlTool.run({ prompt: '动图', outputFormat: 'gif' }), /编码无效/);
}));

test('旧调用不夹带 GIF 字段，GIF 未指定帧参数时不填示例默认值', () => temporary(async dir => {
  const { tool, calls, client } = harness(dir, png);
  await tool.run({ prompt: '静态图' });
  assert.deepEqual(calls[0].body, { model: 'still', prompt: '静态图', size: '1024x1024', response_format: 'b64_json' });
  await client.generate({ model: 'confirmed-animation', prompt: '动图', output_format: 'gif' });
  assert.equal(calls[1].body.size, 'auto');
  assert.equal('frame_count' in calls[1].body, false);
  assert.equal('frame_duration_ms' in calls[1].body, false);
}));

test('模型解析 hook 优先并接收 GIF、image 和 vision 能力', () => temporary(async dir => {
  const seen = [];
  const { tool, calls } = harness(dir, gif, async (...args) => { seen.push(args); return 'hook-model'; });
  await tool.run({ prompt: '动图', outputFormat: 'gif', model: 'requested' });
  await tool.run({ prompt: '静态图' });
  assert.deepEqual(seen, [['gif', 'requested'], ['image', undefined]]);
  assert.ok(calls.every(c => c.body.model === 'hook-model'));
  const vision = mediaTools({ settings: () => ({ visionEnabled: true }), resolveMediaModel: async (...args) => { seen.push(args); return 'vision-hook'; },
    client: { recognize: async args => { assert.equal(args.model, 'vision-hook'); return { choices: [{ message: { content: '识别结果' } }] }; } }, cwd: () => dir })[0];
  await vision.run({ images: ['https://example.com/test.png'] });
  assert.deepEqual(seen[2], ['vision', undefined]);
}));

test('显式线路不被新默认覆盖，参考图最多四张且 GIF data URL 拒绝', async () => {
  let calls = 0;
  const client = createClient({ baseUrl: 'https://api.aitransx.com/v1', getApiKey: () => 'test-key', fetchImpl: async url => {
    calls++;
    assert.equal(url, 'https://api.aitransx.com/v1/images/generations');
    return response(gif);
  } });
  assert.throws(() => client.generate({ model: 'm', prompt: 'p', references: Array(5).fill('https://example.com/a.png') }));
  assert.throws(() => client.generate({ model: 'm', prompt: 'p', references: [`data:image/gif;base64,${gif.toString('base64')}`] }));
  assert.equal(calls, 0);
  await client.generate({ model: 'm', prompt: 'p' });
  assert.equal(calls, 1);
});
