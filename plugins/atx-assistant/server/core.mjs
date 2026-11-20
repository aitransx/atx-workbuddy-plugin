import { isIP } from 'node:net';

const DEFAULT_BASE_URL = 'https://api-hk.aitransx.com/v1';
const NORMAL_LIMIT = 2 * 1024 * 1024;
const IMAGE_LIMIT = 32 * 1024 * 1024;
const INPUT_IMAGE_LIMIT = 4 * 1024 * 1024;

function fail(message, name = 'ValidationError') {
  const error = new Error(message);
  error.name = name;
  return error;
}

function parseHttps(value) {
  if (typeof value !== 'string' || value !== value.trim() || /[\u0000-\u0020\\]/u.test(value)) {
    throw fail('A valid HTTPS URL is required.');
  }
  let url;
  try { url = new URL(value); } catch { throw fail('A valid HTTPS URL is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    throw fail('A valid HTTPS URL without credentials is required.');
  }
  return url;
}

/** Validate syntax and reject obvious local/private addresses; this does not resolve DNS. */
export function validatePublicUrl(value) {
  const url = parseHttps(value);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !host.includes(':')) {
    throw fail('A public HTTPS URL is required.');
  }
  const family = isIP(host);
  if (family === 4) {
    const [a, b, c] = host.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
        a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) ||
        a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
        a === 203 && b === 0 && c === 113) {
      throw fail('A public HTTPS URL is required.');
    }
  } else if (family === 6) {
    // Only global unicast; exclude documentation, Teredo, and other special 2001 prefixes.
    const first = Number.parseInt(host.split(':')[0], 16);
    if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff || /^2001:(?:0{0,3}db8|0{1,4}):/i.test(host)) {
      throw fail('A public HTTPS URL is required.');
    }
  }
  return value;
}

/** Images are public HTTPS URLs or strictly base64 encoded PNG/JPEG/WebP data URLs. */
export function validateImage(value) {
  if (typeof value !== 'string') throw fail('An image URL is required.');
  if (!value.startsWith('data:')) return validatePublicUrl(value);
  if (value.length > Math.ceil(INPUT_IMAGE_LIMIT / 3) * 4 + 64) throw fail('Image exceeds the 4 MiB limit.');
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match || !match[2] || match[2].length % 4 !== 0) throw fail('A PNG, JPEG, or WebP base64 image is required.');
  const bytes = Buffer.from(match[2], 'base64');
  if (bytes.toString('base64') !== match[2]) throw fail('A valid base64 image is required.');
  if (bytes.length > INPUT_IMAGE_LIMIT) throw fail('Image exceeds the 4 MiB limit.');
  return value;
}

function requiredText(value, label, max = Infinity) {
  if (typeof value !== 'string' || !value.trim() || [...value].length > max) {
    throw fail(`A valid ${label} is required.`);
  }
  return value;
}

function safeToken(value, secret) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(value)) return undefined;
  if (secret && value.includes(secret)) return undefined;
  return value;
}

function aborted(signal) {
  return fail(signal.reason?.name === 'TimeoutError' ? 'Request timed out.' : 'Request cancelled.',
    signal.reason?.name === 'TimeoutError' ? 'TimeoutError' : 'AbortError');
}

function withAbort(promise, signal) {
  if (signal.aborted) return Promise.reject(aborted(signal));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

async function readJson(response, limit, signal) {
  const declared = response.headers?.get?.('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* best effort */ }
    throw fail('Response exceeds the size limit.', 'ResponseLimitError');
  }
  if (!response.body || typeof response.body.getReader !== 'function') throw fail('Invalid JSON response.', 'ResponseError');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw fail('Response exceeds the size limit.', 'ResponseLimitError');
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(Buffer.concat(chunks, size).toString('utf8')); }
    catch { throw fail('Invalid JSON response.', 'ResponseError'); }
  } finally {
    // Do not wait for an uncooperative upstream stream to acknowledge cancellation.
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* best effort */ }
    try { reader.releaseLock(); } catch { /* pending read may retain the lock */ }
  }
}

export function validateGenerationOptions({ output_format, frame_count, frame_duration_ms } = {}) {
  if (output_format !== undefined && !['png', 'gif'].includes(output_format)) throw fail('输出格式必须为 png 或 gif。');
  if (output_format !== 'gif' && (frame_count !== undefined || frame_duration_ms !== undefined)) {
    throw fail('帧参数仅适用于 GIF 输出。');
  }
  if (frame_count !== undefined && (!Number.isInteger(frame_count) || frame_count < 1 || frame_count > 16)) {
    throw fail('GIF 帧数须为 1–16 的整数（客户端本地限额）。');
  }
  if (frame_duration_ms !== undefined && (!Number.isSafeInteger(frame_duration_ms) || frame_duration_ms < 1)) {
    throw fail('GIF 每帧时长须为正整数毫秒。');
  }
}

export function createClient({ baseUrl = DEFAULT_BASE_URL, getApiKey = () => process.env.AITRANSX_API_KEY,
  timeoutMs = 180000, fetchImpl = globalThis.fetch } = {}) {
  const base = parseHttps(baseUrl);
  if (base.search || base.hash || baseUrl.includes('?') || baseUrl.includes('#')) throw fail('API base URL cannot contain a query or fragment.');
  if (typeof getApiKey !== 'function' || typeof fetchImpl !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 4294967295) {
    throw fail('Invalid client configuration.');
  }
  const root = base.href.replace(/\/+$/, '');

  async function post(path, body, signal, method = 'POST', { requireKey = method !== 'GET' } = {}) {
    if (typeof path !== 'string' || !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(path)) throw fail('Invalid API path.');
    let key;
    if (requireKey) {
      try { key = await getApiKey(); } catch { throw fail('API key is unavailable.', 'AuthenticationError'); }
      if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) throw fail('API key is unavailable.', 'AuthenticationError');
    } else {
      // Catalog reads are free; send the key when available so account-scoped lists work.
      try { key = await getApiKey(); } catch { key = undefined; }
      if (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key)) key = undefined;
    }
    const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
    if (combined.aborted) throw aborted(combined);
    let payload;
    try { payload = JSON.stringify(body); } catch { throw fail('Invalid request body.'); }
    let response;
    try {
      response = await withAbort(fetchImpl(root + path, {
        method, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: payload } : {}), signal: combined, redirect: 'error',
      }), combined);
    } catch {
      if (combined.aborted) throw aborted(combined);
      throw fail('API request failed.', 'NetworkError');
    }
    if (response.redirected || response.status >= 300 && response.status < 400) {
      try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* best effort */ }
      const error = fail(`HTTP ${response.status}: redirect refused.`, 'HttpError');
      error.status = response.status;
      throw error;
    }
    let data;
    try { data = await readJson(response, path === '/images/generations' ? IMAGE_LIMIT : NORMAL_LIMIT, combined); }
    catch (error) {
      if (combined.aborted) throw aborted(combined);
      if (error?.name === 'ResponseLimitError' || error?.name === 'ResponseError') throw error;
      throw fail('Unable to read API response.', 'ResponseError');
    }
    if (!response.ok) {
      const code = safeToken(data?.error?.code ?? data?.code, key);
      const requestId = safeToken(response.headers?.get?.('x-request-id') ?? response.headers?.get?.('request-id') ?? data?.request_id, key);
      const error = fail(`HTTP ${response.status}${code ? ` (${code})` : ''}${requestId ? `; request id: ${requestId}` : ''}.`, 'HttpError');
      error.status = response.status;
      if (code) error.code = code;
      if (requestId) error.requestId = requestId;
      throw error;
    }
    return data;
  }

  function search({ query, count = 5 } = {}, signal) {
    requiredText(query, 'search query', 128);
    if (!Number.isInteger(count) || count < 1 || count > 10) throw fail('Search count must be an integer from 1 to 10.');
    return post('/tools/search', { query, count, need_content: true }, signal);
  }
  function fetchPage({ url } = {}, signal) {
    validatePublicUrl(url);
    return post('/tools/fetch', { url }, signal);
  }
  function generate({ model, prompt, size, references = [], output_format, frame_count, frame_duration_ms } = {}, signal) {
    validateGenerationOptions({ output_format, frame_count, frame_duration_ms });
    size ??= output_format === 'gif' ? 'auto' : '1024x1024';
    requiredText(model, 'model'); requiredText(prompt, 'prompt'); requiredText(size, 'image size');
    if (!Array.isArray(references) || references.length > 4) throw fail('参考图必须为数组，最多 4 张。');
    references.forEach(validateImage);
    return post('/images/generations', { model, prompt, size, response_format: 'b64_json',
      ...(output_format !== undefined ? { output_format } : {}),
      ...(frame_count !== undefined ? { frame_count } : {}),
      ...(frame_duration_ms !== undefined ? { frame_duration_ms } : {}),
      ...(references.length ? { input_references: references.map(url => ({ type: 'image_url', image_url: { url } })) } : {}) }, signal);
  }
  function recognize({ model, prompt, images } = {}, signal) {
    requiredText(model, 'model'); requiredText(prompt, 'prompt');
    if (!Array.isArray(images) || !images.length) throw fail('At least one image is required.');
    images.forEach(validateImage);
    return post('/chat/completions', { model, messages: [{ role: 'user', content: [
      { type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } })),
    ] }], stream: false }, signal);
  }
  return { post, search, fetchPage, generate, recognize, listModels: signal => post('/models', undefined, signal, 'GET') };
}

// Convenience exports use the standard endpoint and read the key only at request time.
export const search = (...args) => createClient().search(...args);
export const fetchPage = (...args) => createClient().fetchPage(...args);
export const generate = (...args) => createClient().generate(...args);
export const recognize = (...args) => createClient().recognize(...args);
