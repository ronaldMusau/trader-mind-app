// live: read-only live figures from Ronald's Capital.com DEMO account for the Trader Mind app.
// Signed-in users only. It never places, changes or closes anything.
// Secrets (Edge Functions > Secrets): CAPITAL_API_KEY, CAPITAL_LOGIN, CAPITAL_API_PASSWORD
const DEMO = "https://demo-api-capital.backend-capital.com"; // demo only, on purpose
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

let sess: { cst: string; tok: string; at: number } | null = null;
async function login() {
  if (sess && Date.now() - sess.at < 8 * 60_000) return sess; // Capital sessions expire after 10 min idle
  const r = await fetch(DEMO + "/api/v1/session", {
    method: "POST",
    headers: { "X-CAP-API-KEY": Deno.env.get("CAPITAL_API_KEY") ?? "", "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier: Deno.env.get("CAPITAL_LOGIN"),
      password: Deno.env.get("CAPITAL_API_PASSWORD"),
      encryptedPassword: false,
    }),
  });
  if (!r.ok) throw new Error("demo login failed (" + r.status + "): check the three CAPITAL_ secrets");
  sess = { cst: r.headers.get("CST") ?? "", tok: r.headers.get("X-SECURITY-TOKEN") ?? "", at: Date.now() };
  return sess;
}

let fxr: { ccy: string; rate: number; at: number } | null = null;
async function usdRate(ccy: string) { // USD -> account currency, for showing KSh figures in dollars too
  if (!ccy || ccy === "USD") return 1;
  if (fxr && fxr.ccy === ccy && Date.now() - fxr.at < 3600_000) return fxr.rate;
  try {
    const j = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + ccy + "=X?interval=1d&range=5d").then((r) => r.json());
    const rate = j.chart.result[0].meta.regularMarketPrice;
    if (rate > 0) fxr = { ccy, rate, at: Date.now() };
  } catch (_) { /* keep the last known rate */ }
  return fxr?.rate ?? null;
}

async function signedIn(req: Request) {
  const auth = req.headers.get("Authorization") ?? "";
  const apikey = req.headers.get("apikey") ?? "";
  if (!auth.startsWith("Bearer ")) return false;
  const r = await fetch(Deno.env.get("SUPABASE_URL") + "/auth/v1/user", { headers: { Authorization: auth, apikey } });
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    if (!(await signedIn(req))) return json({ error: "sign in first" }, 401);
    const s = await login();
    const h = { CST: s.cst, "X-SECURITY-TOKEN": s.tok };
    const url = new URL(req.url);
    const epics = (url.searchParams.get("epics") ?? "").split(",").filter((e) => /^[A-Z0-9._]{2,20}$/.test(e)).slice(0, 25);
    const [pos, acc, mk] = await Promise.all([
      fetch(DEMO + "/api/v1/positions", { headers: h }).then((r) => r.json()),
      fetch(DEMO + "/api/v1/accounts", { headers: h }).then((r) => r.json()),
      epics.length ? fetch(DEMO + "/api/v1/markets?epics=" + epics.join(","), { headers: h }).then((r) => r.json()) : Promise.resolve({}),
    ]);
    const a = (acc.accounts ?? []).find((x: any) => x.preferred) ?? (acc.accounts ?? [])[0] ?? {};
    const prices: Record<string, { bid: number; offer: number }> = {};
    for (const m of mk.marketDetails ?? []) prices[m.instrument.epic] = { bid: m.snapshot.bid, offer: m.snapshot.offer };
    const usd_rate = await usdRate(a.currency);
    return json({
      at: new Date().toISOString(),
      account: { currency: a.currency, usd_rate, balance: a.balance?.balance, available: a.balance?.available, pnl: a.balance?.profitLoss },
      positions: (pos.positions ?? []).map((p: any) => ({
        dealId: p.position.dealId, epic: p.market.epic, direction: p.position.direction, size: p.position.size,
        level: p.position.level, stop: p.position.stopLevel, target: p.position.profitLevel,
        upl: p.position.upl, currency: p.position.currency, bid: p.market.bid, offer: p.market.offer,
      })),
      prices,
    });
  } catch (e) {
    sess = null;
    return json({ error: String((e as Error).message ?? e) }, 502);
  }
});
