/*
  UBC Finance — Sync Backend (Cloudflare Worker)
  ------------------------------------------------------------------
  Paste this into a Cloudflare Worker (Workers & Pages -> Create ->
  Edit code), bind a KV namespace to it as STATE_KV, then deploy.
  Full setup steps are in README.md.

  This Worker is intentionally simple: it just stores and returns one
  JSON blob (the whole app's data) under a single KV key. All the real
  work — merging records from two devices, tracking deletions so they
  don't reappear, deciding what changed — happens on the client, in
  sync.js. This Worker's only job is "give me what's saved" (GET) and
  "save this instead" (POST).

  NOTE: no PIN — anyone with this Worker's URL can read and write this
  data. Keep the URL itself as the only thing protecting it — don't
  post it publicly. See README for that trade-off.
*/

const STATE_KEY = "ubcfinance-state";

const EMPTY_STATE = {
  income: [], expenditure: [], transactions: [], bankEntries: [],
  bankAccountEntries: [], notes: [], remittances: [],
  customIncomeItems: [], customExpenditureItems: [], tombstones: [],
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS),
  });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method === "GET") {
      const raw = await env.STATE_KV.get(STATE_KEY);
      if (!raw) {
        return json(Object.assign({ ok: true, serverTime: Date.now() }, EMPTY_STATE));
      }
      let state;
      try {
        state = JSON.parse(raw);
      } catch (err) {
        return json({ ok: false, error: "stored state is corrupted" }, 500);
      }
      state.ok = true;
      state.serverTime = Date.now(); // lets each device correct for its own clock being wrong
      return json(state);
    }

    if (request.method === "POST") {
      let body;
      try {
        body = JSON.parse(await request.text());
      } catch (err) {
        return json({ ok: false, error: "bad request body" }, 400);
      }
      await env.STATE_KV.put(STATE_KEY, JSON.stringify(body));
      return json({ ok: true });
    }

    return json({ ok: false, error: "unsupported method" }, 405);
  },
};
