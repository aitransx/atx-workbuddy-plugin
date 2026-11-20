import test from 'node:test';
import assert from 'node:assert/strict';
import { SEED_MODELS, createCatalog } from '../plugins/atx-assistant/server/catalog.mjs';

const vision = 'openai/gpt-6.1-terra';
const image = 'openai/gpt-image-2';

test('corrected trusted seed declarations and initial unknown availability', () => {
  assert.deepEqual(SEED_MODELS.map((m) => m.id), [vision, image]);
  assert.equal(SEED_MODELS.filter((m) => m.vision).length, 1);
  assert.equal(SEED_MODELS.filter((m) => m.image).length, 1);
  assert.ok(SEED_MODELS.every((m) => m.source === 'user-confirmed'));
  const catalog = createCatalog();
  assert.ok(catalog.snapshot().models.every((m) => m.availability === 'unknown'));
  assert.deepEqual(catalog.snapshot(), {
    models: SEED_MODELS.map((m) => ({ ...m, availability: 'unknown' })),
    lastAttempt: null, lastSuccess: null, lastError: null,
  });
});

test('selection validates capabilities, respects explicit requests, and never changes defaults', () => {
  const catalog = createCatalog();
  assert.equal(catalog.select('vision', undefined, vision).id, vision);
  assert.equal(catalog.select('image', image, 'other-default').id, image);
  assert.throws(() => catalog.select('image', vision, image));
  assert.throws(() => catalog.select('vision', 'unknown', vision));
  assert.throws(() => catalog.select('other', vision, vision));
  assert.equal(catalog.select('image', undefined, image).id, image);
  const selected = catalog.select('vision', vision);
  selected.vision = false;
  const snap = catalog.snapshot();
  snap.models[0].vision = false;
  snap.models.length = 0;
  assert.equal(catalog.select('vision', vision).vision, true);
});

test('OpenAI response marks configured missing and discovers without trusting metadata', async () => {
  const catalog = createCatalog({ fetchModels: async () => ({ data: [
    { id: image, vision: true }, { id: 'new-vision-image', vision: true, image: true },
  ] }) });
  await catalog.refresh();
  const snap = catalog.snapshot();
  assert.equal(snap.models.length, 3);
  assert.equal(snap.models.find((m) => m.id === vision).availability, 'missing');
  assert.equal(catalog.select('image', image).availability, 'available');
  assert.throws(() => catalog.select('vision', vision));
  assert.deepEqual(snap.models.find((m) => m.id === 'new-vision-image'), {
    id: 'new-vision-image', vision: false, image: false, source: 'discovered', availability: 'available',
  });
  assert.throws(() => catalog.select('image', 'new-vision-image', image));
});

test('keyed model response only trusts IDs, and configured entries return when available', async () => {
  let response = { models: { [image]: { vision: true }, 'new-model': { image: true } } };
  const catalog = createCatalog({ fetchModels: async () => response });
  await catalog.refresh();
  assert.equal(catalog.snapshot().models.find((m) => m.id === image).vision, false);
  response = { models: { [vision]: {} } };
  await catalog.refresh();
  assert.equal(catalog.select('vision', vision).availability, 'available');
  assert.equal(catalog.snapshot().models.find((m) => m.id === image).availability, 'missing');
  assert.equal(catalog.snapshot().models.some((m) => m.id === 'new-model'), false);
});

test('failed, empty and malformed refreshes retain cache and expose only a fixed safe error', async () => {
  let clock = 0;
  let response = { data: [{ id: vision }] };
  const catalog = createCatalog({ now: () => clock, fetchModels: async () => {
    if (response instanceof Error) throw response;
    return response;
  } });
  await catalog.refresh();
  const saved = catalog.snapshot();
  for (const bad of [new Error('SECRET_TOKEN https://private.example'), {}, { data: [] },
    { models: {} }, { data: [{ id: '' }, { id: 'x'.repeat(257) }, { id: ' ' }, null] }]) {
    clock += 1;
    response = bad;
    await catalog.refresh();
    assert.deepEqual(catalog.snapshot().models, saved.models);
    assert.equal(catalog.snapshot().lastSuccess, 0);
    assert.equal(catalog.snapshot().lastAttempt, clock);
    assert.equal(catalog.snapshot().lastError, 'Model catalog refresh failed.');
  }
  response = { data: [{ id: image }] };
  await catalog.refresh();
  assert.equal(catalog.snapshot().lastError, null);
  assert.equal(catalog.snapshot().lastSuccess, clock);
});

test('catalog bound is 10000 with ID length limit and configured entries preserved', async () => {
  const catalog = createCatalog({ fetchModels: async () => ({ data: [
    { id: 'x'.repeat(257) }, { id: 'z'.repeat(256) }, { id: '界'.repeat(85) }, { id: '界'.repeat(86) },
    ...Array.from({ length: 12000 }, (_, i) => ({ id: `remote-${i}` })),
  ] }) });
  await catalog.refresh();
  const { models } = catalog.snapshot();
  assert.equal(models.length, 10000);
  assert.ok(SEED_MODELS.every((seed) => models.some((m) => m.id === seed.id)));
  assert.ok(models.some((m) => m.id === 'z'.repeat(256)));
  assert.ok(models.some((m) => m.id === '界'.repeat(85)));
  assert.ok(models.every((m) => Buffer.byteLength(m.id, 'utf8') <= 256));
});

test('concurrent refresh and ensureFresh share a single request and signal', async () => {
  let resolve;
  let calls = 0;
  let seenSignal;
  const signal = new AbortController().signal;
  const catalog = createCatalog({ fetchModels: (arg) => {
    calls += 1;
    seenSignal = arg;
    return new Promise((done) => { resolve = done; });
  } });
  const first = catalog.refresh(signal);
  const second = catalog.refresh();
  const third = catalog.ensureFresh();
  assert.equal(first, second);
  assert.equal(first, third);
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(seenSignal, signal);
  resolve({ data: [{ id: vision }] });
  await Promise.all([first, second, third]);
});

test('automatic refresh starts on first call and rate-limits failures by lastAttempt, including zero', async () => {
  let clock = 0;
  let calls = 0;
  const catalog = createCatalog({ now: () => clock, refreshHours: 1, fetchModels: async () => {
    calls += 1;
    throw new Error('private');
  } });
  await catalog.ensureFresh();
  assert.equal(calls, 1);
  clock = 3599999;
  await catalog.ensureFresh();
  assert.equal(calls, 1);
  clock = 3600000;
  await catalog.ensureFresh();
  assert.equal(calls, 2);
  await catalog.refresh();
  assert.equal(calls, 3);
});

test('GIF 能力仅信任本地明确声明，不为旧条目添加 gif:false', async () => {
  const catalog = createCatalog({ models: [{ id: 'animation', gif: true }, { id: 'still', image: true, gif: false }],
    fetchModels: async () => ({ data: [{ id: 'animation' }, { id: 'still', gif: true }, { id: 'remote-gif', gif: true }] }) });
  assert.equal(catalog.select('gif', undefined, 'animation').gif, true);
  assert.throws(() => catalog.select('gif', 'still'));
  await catalog.refresh();
  assert.equal(catalog.select('gif', 'animation').availability, 'available');
  assert.throws(() => catalog.select('gif', 'remote-gif'));
  assert.ok(catalog.snapshot().models.filter(m => m.id !== 'animation').every(m => !Object.hasOwn(m, 'gif')));
  assert.ok(SEED_MODELS.every(m => !m.gif));
});

test('本地能力 ID 也按 UTF-8 的 256 字节边界校验', () => {
  const accepted = ['a'.repeat(256), '界'.repeat(85), '😀'.repeat(64)];
  const rejected = ['a'.repeat(257), '界'.repeat(86), '😀'.repeat(65)];
  const catalog = createCatalog({ models: [...accepted, ...rejected].map(id => ({ id, gif: true })) });
  assert.deepEqual(catalog.snapshot().models.map(m => m.id), accepted);
});

test('zero hours disables automatic refresh but explicit refresh works', async () => {
  let calls = 0;
  const catalog = createCatalog({ refreshHours: 0, fetchModels: async () => {
    calls += 1;
    return { data: [{ id: vision }] };
  } });
  await catalog.ensureFresh();
  assert.equal(calls, 0);
  await catalog.refresh();
  assert.equal(calls, 1);
  await catalog.ensureFresh();
  assert.equal(calls, 1);
});
