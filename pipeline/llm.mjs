// One OpenRouter interface for every model-driven stage. The model per stage comes from
// models.json; nothing else in the pipeline names a model. Every call is logged (model, parameters,
// tokens, cost, time), and a hard per-run spend cap stops the run before the next call.
import { readFileSync, appendFileSync } from 'node:fs';

export const CONFIG = JSON.parse(readFileSync(new URL('./models.json', import.meta.url), 'utf8'));
const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';

export class SpendCapError extends Error {}

export function stageSetting(stage, profile = process.env.MYRIAS_PROFILE || 'demo') {
  const p = CONFIG.profiles[profile];
  if (!p) throw new Error(`unknown profile "${profile}"`);
  if (!p[stage]) throw new Error(`profile "${profile}" has no stage "${stage}"`);
  return { profile, ...p[stage] };
}

// Rough pre-call estimate in USD, used only to refuse a call that would clearly break the cap.
export function estimateCost(model, inputChars, maxOutputTokens) {
  const price = CONFIG.prices[model];
  if (!price) return 0;
  return ((inputChars / 3) * price[0] + maxOutputTokens * price[1]) / 1e6;
}

export function createClient({ apiKey = process.env.OPENROUTER_API_KEY, capUsd, logPath, fetchImpl = fetch, profile } = {}) {
  if (!(capUsd > 0)) throw new Error('capUsd is required: every run has a hard spend cap');
  let spent = 0, calls = 0;
  async function call(stage, { system, user, schema, maxTokens = 2000, model: override } = {}) {
    if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
    const setting = stageSetting(stage, profile);
    const model = override || setting.model;
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: user }];
    const projected = spent + estimateCost(model, messages.reduce((n, m) => n + m.content.length, 0), maxTokens);
    if (projected > capUsd) throw new SpendCapError(`spend cap $${capUsd} would be exceeded (spent $${spent.toFixed(4)}, projected $${projected.toFixed(4)})`);
    const body = {
      model, messages, max_tokens: maxTokens, temperature: setting.temperature ?? 0,
      provider: CONFIG.provider, usage: { include: true },
      ...(schema ? { response_format: { type: 'json_schema', json_schema: { name: stage, strict: true, schema } } } : {})
    };
    const t0 = Date.now();
    const res = await fetchImpl(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${json?.error?.message || 'request failed'}`);
    const usage = json.usage || {};
    const cost = Number(usage.cost) || 0;
    spent += cost; calls += 1;
    const text = json.choices?.[0]?.message?.content ?? '';
    let data = null;
    if (schema) { try { data = JSON.parse(text); } catch { data = null; } }
    const entry = { at: new Date().toISOString(), stage, profile: setting.profile, model: json.model || model, requested_model: model,
      temperature: body.temperature, input_tokens: usage.prompt_tokens ?? null, output_tokens: usage.completion_tokens ?? null,
      cost_usd: cost, ms: Date.now() - t0, parsed: schema ? data !== null : null };
    if (logPath) appendFileSync(logPath, JSON.stringify(entry) + '\n');
    return { text, data, entry };
  }
  return { call, get spent() { return spent; }, get calls() { return calls; }, capUsd };
}
