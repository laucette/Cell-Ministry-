import { getStore } from "@netlify/blobs";

export const config = { path: "/api/*" };

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const wk = (y, m, w) => `${Number(y)}-${Number(m)}-${Number(w)}`;
const str = (v, n = 120) => String(v ?? "").trim().slice(0, n);
const int = (v) => { const n = Number(v); return v !== "" && v != null && Number.isInteger(n) && n >= 0 && n <= 99999 ? n : null; };
const money = (v) => { const n = Number(v); return v !== "" && v != null && Number.isFinite(n) && n >= 0 && n <= 1e9 ? Math.round(n * 100) / 100 : null; };
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => ALPHA[b % ALPHA.length]).join("");

export default async (req) => {
  const store = getStore("cmsa");
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "").replace(/\/$/, "");
  const q = url.searchParams;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const adminKey = String((typeof Netlify !== "undefined" && Netlify.env.get("ADMIN_KEY")) || process.env.ADMIN_KEY || "").trim();
  const isAdmin = !!adminKey && (req.headers.get("x-admin-key") || "").trim() === adminKey;

  try {
    const roster = (await store.get("roster", { type: "json" })) || [];
    const open = (await store.get("open", { type: "json" })) || null;
    const leaderFor = (c) => { c = str(c, 12).toUpperCase(); return c ? roster.find((r) => r.code === c) : null; };

    // ---- leader endpoints (access code only) ----
    if (route === "me") {
      const l = leaderFor(q.get("code"));
      if (!l) return json({ error: "That access code is not valid." }, 404);
      const sub = open ? await store.get(`s/${wk(open.y, open.m, open.w)}/${l.code}`, { type: "json" }) : null;
      return json({ leader: l.leader, cell: l.cell, pcf: l.pcf, open, sub });
    }
    if (route === "submit" && req.method === "POST") {
      const l = leaderFor(body.code);
      if (!l) return json({ error: "That access code is not valid." }, 404);
      if (!open) return json({ error: "Submissions are not open yet." }, 409);
      if (open.closed) return json({ error: "Submissions for this week are closed." }, 409);
      const week = wk(open.y, open.m, open.w);
      const key = `s/${week}/${l.code}`;
      const old = await store.get(key, { type: "json" });
      if (old && old.status === "approved") return json({ error: "Your report was already approved." }, 409);

      const held = body.held === true || body.held === "yes";
      const sa = int(body.sa);
      if (sa === null) return json({ error: "Enter the Sunday service attendance." }, 400);
      const rec = {
        code: l.code, pcf: l.pcf, leader: l.leader, cell: l.cell,
        cm: held ? "g" : "r", sa, note: str(body.note, 300), ts: Date.now(), status: "pending",
      };
      if (held) {
        const date = str(body.date, 10), time = str(body.time, 5), venue = str(body.venue);
        const att = int(body.att), ft = int(body.ft), ba = int(body.ba), tg = int(body.tg), offer = money(body.offer);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || venue.length < 2 || [att, ft, ba, tg, offer].some((v) => v === null))
          return json({ error: "Please fill in every meeting detail." }, 400);
        Object.assign(rec, { date, time, venue, att, ft, ba, tg, offer });
      } else if (rec.note.length < 3) {
        return json({ error: "Please give a short reason the meeting did not hold." }, 400);
      }
      rec.photo = !!(old && old.photo);
      if (typeof body.photo === "string" && body.photo.startsWith("data:image/jpeg;base64,")) {
        const b64 = body.photo.slice(23);
        if (b64.length > 2500000) return json({ error: "That photo is too large." }, 413);
        await store.set(`p/${week}/${l.code}`, Uint8Array.from(Buffer.from(b64, "base64")).buffer);
        rec.photo = true;
      }
      await store.setJSON(key, rec);
      return json({ ok: true, sub: rec });
    }

    // ---- admin endpoints (x-admin-key header) ----
    if (route.startsWith("admin/")) {
      if (!adminKey) return json({ error: "The server cannot see ADMIN_KEY. Check it is set for Functions in Netlify, then redeploy." }, 500);
      if (!isAdmin) return json({ error: "Wrong or missing admin key." }, 401);
      const a = route.slice(6);
      if (a === "state") {
        const { blobs } = await store.list({ prefix: `s/${wk(q.get("y"), q.get("m"), q.get("w"))}/` });
        const subs = (await Promise.all(blobs.map((b) => store.get(b.key, { type: "json" })))).filter(Boolean);
        return json({ roster, open, subs });
      }
      if (a === "photo") {
        const buf = await store.get(`p/${wk(q.get("y"), q.get("m"), q.get("w"))}/${str(q.get("code"), 12).toUpperCase()}`, { type: "arrayBuffer" });
        if (!buf) return json({ error: "No photo." }, 404);
        return new Response(buf, { headers: { "content-type": "image/jpeg", "cache-control": "no-store" } });
      }
      if (a === "roster" && req.method === "POST") {
        const used = new Set();
        const clean = (Array.isArray(body.roster) ? body.roster : []).slice(0, 600).map((r) => {
          let code = str(r.code, 12).toUpperCase();
          if (!code || used.has(code)) { do { code = newCode(); } while (used.has(code)); }
          used.add(code);
          return { pcf: str(r.pcf), leader: str(r.leader), cell: str(r.cell), ph: str(r.ph, 20), code };
        }).filter((r) => r.pcf && r.leader);
        await store.setJSON("roster", clean);
        return json({ ok: true, roster: clean });
      }
      if (a === "open" && req.method === "POST") {
        const o = { y: Number(body.y), m: Number(body.m), w: Number(body.w), closed: false };
        await store.setJSON("open", o);
        return json({ ok: true, open: o });
      }
      if (a === "close" && req.method === "POST") {
        if (!open) return json({ error: "No week is open yet." }, 409);
        const o = { ...open, closed: !!body.closed };
        await store.setJSON("open", o);
        return json({ ok: true, open: o });
      }
      if (a === "review" && req.method === "POST") {
        const key = `s/${wk(body.y, body.m, body.w)}/${str(body.code, 12).toUpperCase()}`;
        const rec = await store.get(key, { type: "json" });
        if (!rec) return json({ error: "Submission not found." }, 404);
        rec.status = ["approved", "rejected", "pending"].includes(body.status) ? body.status : rec.status;
        if (["g", "y", "r"].includes(body.off)) rec.off = body.off;
        if (["g", "y", "r"].includes(body.cmc)) rec.cmc = body.cmc;
        await store.setJSON(key, rec);
        return json({ ok: true, sub: rec });
      }
    }
    return json({ error: "Not found" }, 404);
  } catch (e) {
    return json({ error: "Server error. Check the Netlify function logs." }, 500);
  }
};
