// Preloaded with --import in tests: replaces fetch so pipeline/run.mjs never calls the network.
// It returns, for any window, one claim quoting the window's first sentence, plus one invented quote.
globalThis.fetch = async (url, opts) => {
  const body = JSON.parse(opts.body);
  const passage = body.messages.at(-1).content.split('"""')[1] || '';
  const first = (passage.trim().match(/^[^。.]*[。.]/) || [passage.trim().slice(0, 20)])[0];
  const claim = q => ({ quote: q, statement: '鳜鱼可驯化', intervention: '驯化', intervention_key: 'feed-training', candidate_status: 'clear', basis: 'measured', polarity: 'supportive', welfare_relevance: 'feeding', species: '', production_system: '', limitations: '', counterevidence: '', uncertainty: '' });
  const content = JSON.stringify({ claims: [claim(first), claim('这句话不在原文中出现过的。')] });
  return { ok: true, status: 200, json: async () => ({ model: body.model, choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10, cost: 0.0001 } }) };
};
