// watch: checks Ronald's open Capital.com DEMO trades every minute (called by pg_cron) and acts at once.
// It can ONLY reduce risk: move a stop to breakeven, or close a trade whose profit is fading.
// It never opens, adds to or enlarges a trade. Demo host only. The hourly manager (capital_demo.py manage)
// keeps the slower rules (trend flip, 72 h limit). When a trade's position is gone at the broker, this watcher also
// records the real exit (price, reason, R, P/L) so the app stays true even when Ronald's PC is off (Lesson 40).
// Secrets: CAPITAL_API_KEY, CAPITAL_LOGIN, CAPITAL_API_PASSWORD, WATCH_KEY, NTFY_TOPIC (+ built-in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)
const DEMO = "https://demo-api-capital.backend-capital.com"; // demo only, on purpose
const BREAKEVEN_AT_R = 1.0, FADE_PEAK_R = 0.8, FADE_EXIT_R = 0.25; // same numbers as the hourly manager (v2 rules)
const SB = Deno.env.get("SUPABASE_URL")!, KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sbh = { apikey: KEY, Authorization: "Bearer " + KEY, "Content-Type": "application/json" };

async function sb(path: string, init: RequestInit = {}) {
  const r = await fetch(SB + "/rest/v1/" + path, { ...init, headers: { ...sbh, ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error("db " + path.split("?")[0] + " " + r.status + " " + (await r.text()).slice(0, 200));
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}

let sess: { cst: string; tok: string; at: number } | null = null;
async function cap(method: string, path: string, body?: unknown) {
  if (!sess || Date.now() - sess.at > 8 * 60_000) {
    const r = await fetch(DEMO + "/api/v1/session", {
      method: "POST",
      headers: { "X-CAP-API-KEY": Deno.env.get("CAPITAL_API_KEY") ?? "", "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: Deno.env.get("CAPITAL_LOGIN"), password: Deno.env.get("CAPITAL_API_PASSWORD"), encryptedPassword: false }),
    });
    if (!r.ok) throw new Error("demo login failed " + r.status);
    sess = { cst: r.headers.get("CST") ?? "", tok: r.headers.get("X-SECURITY-TOKEN") ?? "", at: Date.now() };
  }
  const r = await fetch(DEMO + path, {
    method, headers: { CST: sess.cst, "X-SECURITY-TOKEN": sess.tok, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(method + " " + path + " " + r.status + " " + (await r.text()).slice(0, 200));
  return r.json();
}

function watching(st: any): boolean { // same rule as oanda_demo.watching(): Ronald's watch hours, Nairobi time
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const g = (k: string) => p.find((x) => x.type === k)!.value;
  const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], d = g("weekday").toLowerCase().slice(0, 3);
  const m = (+g("hour") % 24) * 60 + +g("minute"), mins = (x: string) => +x.slice(0, 2) * 60 + +x.slice(3, 5);
  const w = st?.watch?.[d];
  if (w?.[0] && w?.[1]) { const a = mins(w[0]), b = mins(w[1]); if (a <= b ? m >= a && m < b : m >= a) return true; }
  const pw = st?.watch?.[days[(days.indexOf(d) + 6) % 7]];
  if (pw?.[0] && pw?.[1]) { const a = mins(pw[0]), b = mins(pw[1]); if (a > b && m < b) return true; }
  return false;
}

async function alert(title: string, text: string, loud: boolean) {
  const topic = Deno.env.get("NTFY_TOPIC");
  if (!topic) return;
  await fetch("https://ntfy.sh/" + topic, { method: "POST", body: text,
    headers: { Title: title, Priority: loud ? "high" : "low", Tags: "chart_with_upwards_trend",
               Click: "https://ronaldmusau.github.io/trader-mind-app/" } }).catch(() => {});
}

// If the hourly runs (Ronald's PC, or the Claude fallback) stop checking in for 2 hours, say so - at most every 6 hours.
async function heartbeat(loud: boolean) {
  const hb = (await sb("snapshots?key=eq.heartbeat&select=data"))[0]?.data;
  if (!hb?.at) return null;
  const ageH = (Date.now() - Date.parse(hb.at)) / 3_600_000;
  if (ageH < 2) return null;
  const st = (await sb("watch_state?trade_id=eq.__heartbeat__&select=acted_at"))[0];
  if (st?.acted_at && Date.now() - Date.parse(st.acted_at) < 6 * 3_600_000) return null;
  await alert("Trading runs have stopped", `No hourly run for ${ageH.toFixed(1)} h (last at ${String(hb.at).slice(11, 16)} UTC on ${hb.host ?? "the PC"}). ` +
    "Check the PC is on, awake and online. Open trades are still protected by this minute watcher.", true);
  await sb("watch_state?on_conflict=trade_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({ trade_id: "__heartbeat__", action: `runs stopped ${ageH.toFixed(1)} h`, acted_at: new Date().toISOString(),
                           updated_at: new Date().toISOString() }) });
  return ageH;
}

// Capital.com gives at most 1 day of history per request (Lesson 39): read the last 3 days in 1-day windows, once per run.
let hist: any[] | null = null;
async function history() {
  if (hist) return hist;
  hist = [];
  const iso = (d: Date) => d.toISOString().slice(0, 19);
  let end = new Date();
  for (let i = 0; i < 3; i++) {
    const from = new Date(end.getTime() - 86_400_000);
    const j = await cap("GET", `/api/v1/history/activity?from=${iso(from)}&to=${iso(end)}&detailed=true`).catch(() => null);
    hist.push(...(j?.activities ?? []));
    end = from;
  }
  return hist;
}
const SRC: Record<string, string> = { SL: "stop hit", TP: "target hit", USER: "closed (watcher or by hand)", CLOSE_OUT: "margin close-out" };

async function recordClose(t: any) {
  const acts = (await history()).filter((x: any) => x.dealId === t.deal_id && x.source !== "SYSTEM" && x.details?.level)
    .sort((a: any, b: any) => String(a.dateUTC).localeCompare(String(b.dateUTC)));
  const x = acts.length > 1 ? acts[acts.length - 1] : null;      // the first row is the opening fill
  if (!x) return null;
  const exit = +x.details.level, long = t.side === "buy", entry = +t.entry, risk = Math.abs(entry - +t.stop) || 1e-9;
  const r = (long ? exit - entry : entry - exit) / risk;
  const w = (await sb(`watch_state?trade_id=eq.${encodeURIComponent(t.id)}&select=action`))[0]?.action ?? "";
  const why = x.source === "USER" && String(w).startsWith("closed") ? "minute watcher " + w : (SRC[x.source] ?? x.source);
  await sb(`trades?id=eq.${encodeURIComponent(t.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ status: "closed", exit, closed_at: String(x.dateUTC).slice(0, 19) + "Z", r: +r.toFixed(3),
      result: r > 0 ? "win" : "loss", pnl_usd: t.risk_usd != null ? +(r * Math.abs(+t.risk_usd)).toFixed(2) : null,
      expectation: `Closed at ${exit}: ${why} (recorded by the cloud watcher; the PC refines P/L to the broker's figure).`,
      updated_at: new Date().toISOString() }) });
  return `${t.instrument}: recorded close at ${exit} (${why}, ${r >= 0 ? "+" : ""}${r.toFixed(2)}R)`;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-watch-key") !== Deno.env.get("WATCH_KEY")) return new Response("no", { status: 401 });
  const done: string[] = [];
  hist = null;                                            // fresh broker history each minute
  try {
    const trades = await sb("trades?status=eq.open&mode=eq.demo&deal_id=not.is.null&select=id,instrument,side,entry,stop,target,deal_id,risk_usd,opened_at");
    const stopped = await heartbeat(true).catch(() => null);   // urgent either way: Ronald needs to know
    if (!trades.length) return Response.json({ ok: true, open: 0, runs_stopped_h: stopped });
    const live = Object.fromEntries((await cap("GET", "/api/v1/positions")).positions.map((p: any) => [p.position.dealId, p]));
    const state = Object.fromEntries((await sb("watch_state?select=*")).map((s: any) => [s.trade_id, s]));
    const st = ((await sb("settings?key=eq.main&select=data"))[0] ?? {}).data ?? {};
    const loud = watching(st);
    for (const t of trades) {
      const p = live[t.deal_id];
      if (!p) {                                           // closed at the broker: record it now (the PC may be off)
        const msg = await recordClose(t).catch(() => null);
        if (msg) done.push(msg);
        continue;
      }
      const pos = p.position, long = pos.direction === "BUY";
      const price = long ? p.market.bid : p.market.offer, entry = +pos.level;
      const risk = Math.abs(entry - +t.stop) || 1e-9;
      const r = (long ? price - entry : entry - price) / risk;
      const s = state[t.id] ?? { trade_id: t.id, peak_r: 0, be_done: false };
      const peak = Math.max(+s.peak_r || 0, r);
      let action: string | null = null;
      if (peak >= FADE_PEAK_R && r > 0 && r <= FADE_EXIT_R) {
        await cap("DELETE", "/api/v1/positions/" + t.deal_id);
        action = `closed: profit fading (peak +${peak.toFixed(2)}R, now +${r.toFixed(2)}R)`;
        await alert(`Closed ${t.side.toUpperCase()} ${t.instrument.replace("_", "/")} (watcher)`, `Banked the profit at ${price}: ${action}.`, loud);
      } else if (r >= BREAKEVEN_AT_R && !s.be_done && Math.abs(+(pos.stopLevel ?? 0) - entry) > risk * 0.05) {
        await cap("PUT", "/api/v1/positions/" + t.deal_id, { stopLevel: entry, profitLevel: pos.profitLevel });
        action = `stop moved to breakeven at +${r.toFixed(2)}R`;
        await alert(`Protected ${t.side.toUpperCase()} ${t.instrument.replace("_", "/")}`, `Worst case is now about $0: ${action}.`, loud);
      }
      await sb("watch_state?on_conflict=trade_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ trade_id: t.id, peak_r: +peak.toFixed(3), last_r: +r.toFixed(3),
          be_done: s.be_done || (action?.startsWith("stop moved") ?? false),
          ...(action ? { action, acted_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }) });
      if (action) done.push(t.instrument + ": " + action);
    }
    return Response.json({ ok: true, open: trades.length, done });
  } catch (e) {
    sess = null;
    return Response.json({ ok: false, error: String((e as Error).message ?? e), done }, { status: 500 });
  }
});
