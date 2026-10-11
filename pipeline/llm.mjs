// One OpenRouter interface for every model-driven stage. The model per stage comes from
// models.json; nothing else in the pipeline names a model. Every call is logged (model, parameters,
// tokens, cost, time), and a hard per-run spend cap stops the run before the next call.
import { readFileSync, appendFileSync } from 'node:fs';

export const CONFIG = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8'));
const RETRYABLE = [429, 500, 502, 503];
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export class SpendCapError extends Error {}

export function stageSetting(stage, profile = process.env.MYRIAS_PROFILE || 'demo') {
  const p = CONFIG.profiles[profile];
  if (!p) throw new Error(`unknown profile "${profile}"`);
  if (!p[stage]) throw new Error(`profile "${profile}" has no stage "${stage}"`);
  return { profile, ...p[stage] };
}

// Worst-case cost of one call in USD: the full output budget, and input tokens counted
// conservatively (about one per Chinese character, one per three other characters). A model with
// no listed price is charged at a deliberately high default so it cannot slip under the cap.
const DEFAULT_PRICE = [5, 25];
export function estimateTokens(text) {
  const s = String(text || ''), cjk = (s.match(/[\u3000-\u9fff\uff00-\uffef]/g) || []).length;
  return Math.ceil(cjk * 1.2 + (s.length - cjk) / 3);
}
export function estimateCost(model, input, maxOutputTokens) {
  const price = CONFIG.prices[model] || DEFAULT_PRICE;
  const inTokens = typeof input === 'number' ? input / 3 : estimateTokens(input);
  return (inTokens * price[0] + maxOutputTokens * price[1]) / 1e6;
}

export function createClient({ apiKey = process.env.OPENROUTER_API_KEY, capUsd, logPath, fetchImpl = fetch, profile, retryMs = 8000, retries = 2 } = {}) {
  // No cap unless one is given: spending is still tracked, logged per call and reported.
  if (!(capUsd > 0)) capUsd = Infinity;
  // Budget reservation: a call reserves its worst-case cost before it is sent and releases it when
  // the real cost is known, so concurrent calls can never take the run past the cap.
  let spent = 0, reserved = 0, calls = 0, inFlight = 0;
  async function call(stage, { system, user, images, schema, maxTokens = null, model: override } = {}) {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
    const setting = stageSetting(stage, profile);
    const model = override || setting.model;
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: images?.length ? [{ type: 'text', text: user }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] : user }];
    const candidates = [model, ...(override ? [] : setting.fallback || [])];
    const inputText = messages.map(m => (typeof m.content === 'string' ? m.content : m.content.map(p => p.text || '').join(''))).join('\n');
    const worst = Math.max(...candidates.map(m => estimateCost(m, inputText, maxTokens ?? 32000))) + (images?.length || 0) * 0.002;
    if (spent + reserved + worst > capUsd) throw new SpendCapError(`spend cap $${capUsd} would be exceeded (spent $${spent.toFixed(4)}, reserved $${reserved.toFixed(4)}, this call up to $${worst.toFixed(4)})`);
    reserved += worst; inFlight++;
    try {
    const body = {
      model, messages, ...(maxTokens ? { max_tokens: maxTokens } : {}), temperature: setting.temperature ?? 0,
      provider: CONFIG.provider, usage: { include: true },
      ...(setting.reasoning ? { reasoning: setting.reasoning } : {}),
      ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: stage, strict: true, schema } } } : {})
    };
    const t0 = Date.now();
    // Retry a rate-limited or failing provider, then fall back to the next model listed for the stage.
    // The model that actually answered is what the log and every record store.
    let res, json, used = model;
    for (const m of candidates) {
      used = m; body.model = m;
      for (let attempt = 0; ; attempt++) {
        res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        json = await res.json().catch(() => ({}));
        if (res.ok || !RETRYABLE.includes(res.status) || attempt >= retries) break;
        await new Promise(r => setTimeout(r, retryMs * 2 ** attempt));
      }
      if (res.ok || !RETRYABLE.includes(res.status)) break;
    }
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${json?.error?.message || 'request failed'}${json?.error?.metadata?.raw ? ' (' + String(json.error.metadata.raw).slice(0, 160) + ')' : ''}`);
    const usage = json.usage || {};
    const cost = Number(usage.cost) || 0;
    spent += cost; calls += 1;
    const text = json.choices?.[0]?.message?.content ?? '';
    let data = null;
    if (schema) { try { data = JSON.parse(text); } catch { data = null; } }
    const entry = { at: new Date().toISOString(), stage, profile: setting.profile, model: json.model || used, requested_model: model,
      temperature: body.temperature, input_tokens: usage.prompt_tokens ?? null, output_tokens: usage.completion_tokens ?? null,
      finish: json.choices?.[0]?.finish_reason ?? null, cost_usd: cost, ms: Date.now() - t0, parsed: schema ? data !== null : null };
    if (logPath) appendFileSync(logPath, JSON.stringify(entry) + '\n');
    return { text, data, entry };
    } finally { inFlight--; reserved = inFlight ? Math.max(0, reserved - worst) : 0; }
  }
  return { call, get spent() { return spent; }, get reserved() { return reserved; }, get calls() { return calls; }, capUsd };
}
