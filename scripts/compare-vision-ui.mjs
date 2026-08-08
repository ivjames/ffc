// Standalone web UI for the vision-provider bake-off
// (IMAGE-DESCRIPTION-PRICING.md). The page itself lives in
// scripts/lib/vision-compare-page.mjs and is also mounted inside Master
// Control (server/routes/admin/visionBakeoff.js) — prefer that mount when the
// admin is deployed, since it comes with HTTPS and login for free. This
// server is the zero-infrastructure fallback: run it anywhere with keys.
//
// Usage (same env keys as the CLI; providers without a key show as disabled):
//   node scripts/compare-vision-ui.mjs        # http://127.0.0.1:8787
//   PORT=9000 node scripts/compare-vision-ui.mjs
//
// Binds 127.0.0.1 by default. To judge from another device (phone/iPad)
// without an SSH tunnel, expose it WITH a token — the /api routes proxy paid
// model calls, so they must not sit open on the internet:
//   HOST=0.0.0.0 BAKEOFF_TOKEN=$(openssl rand -hex 16) node scripts/compare-vision-ui.mjs
//   # then open  http://<droplet-ip>:8787/?token=<that token>
// Plain HTTP: fine for a short bake-off session; stop the server when done.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  PROVIDERS,
  MEDIA_TYPES,
  DEFAULT_PROMPT,
  isConfigured,
  describeImage,
  prescanSubject,
} from "./lib/vision-compare-core.mjs";
import { renderPage } from "./lib/vision-compare-page.mjs";
import {
  listDataset,
  addDatasetImage,
  getDatasetImage,
  updateSubject,
  removeDatasetImage,
  clearDataset,
  appendRun,
  clearRuns,
  runsSummary,
} from "./lib/vision-compare-store.mjs";

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN = process.env.BAKEOFF_TOKEN || "";
const LOCAL_ONLY = HOST === "127.0.0.1" || HOST === "localhost";

if (!LOCAL_ONLY && !TOKEN) {
  console.error(
    "refusing to bind " + HOST + " without BAKEOFF_TOKEN — the /api routes " +
      "proxy paid model calls.\nRun: HOST=" + HOST +
      " BAKEOFF_TOKEN=$(openssl rand -hex 16) node scripts/compare-vision-ui.mjs",
  );
  process.exit(1);
}

// Constant-time token check; token arrives as a Bearer header (the page pulls
// it from its ?token= query param and attaches it to every API call).
function authorized(req) {
  if (!TOKEN) return true;
  const header = req.headers.authorization || "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Base64 photos from a phone can hit ~10MB; leave headroom.
const MAX_BODY_BYTES = 25 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set(Object.values(MEDIA_TYPES));

const PAGE = renderPage("/api");

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  try {
    // The page itself carries no secrets, so it's served unauthenticated;
    // everything under /api requires the token when one is configured.
    if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(PAGE);
      return;
    }

    if (req.url.startsWith("/api/") && !authorized(req)) {
      return json(res, 401, {
        error: "missing or wrong token — open the page as /?token=<BAKEOFF_TOKEN>",
      });
    }

    if (req.method === "GET" && req.url === "/api/providers") {
      json(res, 200, {
        defaultPrompt: DEFAULT_PROMPT,
        providers: PROVIDERS.map((p) => ({
          name: p.name,
          model: p.model,
          keyEnv: p.keyEnv,
          configured: isConfigured(p),
          priceIn: p.price.in,
          priceOut: p.price.out,
        })),
      });
      return;
    }

    // Persistent dataset + run history (same store as the admin mount).
    if (req.method === "GET" && req.url === "/api/dataset") {
      return json(res, 200, { images: listDataset() });
    }
    if (req.method === "POST" && req.url === "/api/dataset") {
      const body = JSON.parse(await readBody(req));
      if (!ALLOWED_MEDIA_TYPES.has(body.mediaType))
        return json(res, 400, { error: "unsupported media type" });
      if (typeof body.imageBase64 !== "string" || !body.imageBase64)
        return json(res, 400, { error: "missing image" });
      return json(res, 200, addDatasetImage({
        name: body.name,
        subject: body.subject,
        mediaType: body.mediaType,
        base64: body.imageBase64,
      }));
    }
    let m = req.url.match(/^\/api\/dataset\/([0-9a-f-]+)\/image$/);
    if (req.method === "GET" && m) {
      const found = getDatasetImage(m[1]);
      if (!found) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "content-type": found.entry.mediaType });
      return res.end(found.bytes);
    }
    m = req.url.match(/^\/api\/dataset\/([0-9a-f-]+)\/subject$/);
    if (req.method === "POST" && m) {
      const body = JSON.parse(await readBody(req));
      const entry = updateSubject(m[1], body.subject);
      return entry ? json(res, 200, entry) : json(res, 404, { error: "not found" });
    }
    m = req.url.match(/^\/api\/dataset\/([0-9a-f-]+)$/);
    if (req.method === "DELETE" && m) {
      return removeDatasetImage(m[1])
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "not found" });
    }
    if (req.method === "DELETE" && req.url === "/api/dataset") {
      clearDataset();
      return json(res, 200, { ok: true });
    }
    if (req.method === "POST" && req.url === "/api/runs") {
      appendRun(JSON.parse(await readBody(req)) || {});
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && req.url === "/api/runs/summary") {
      return json(res, 200, runsSummary());
    }
    if (req.method === "DELETE" && req.url === "/api/runs") {
      clearRuns();
      return json(res, 200, { ok: true });
    }

    if (req.method === "POST" && req.url === "/api/prescan") {
      const body = JSON.parse(await readBody(req));
      if (!ALLOWED_MEDIA_TYPES.has(body.mediaType))
        return json(res, 400, { error: "unsupported media type" });
      if (typeof body.imageBase64 !== "string" || !body.imageBase64)
        return json(res, 400, { error: "missing image" });
      try {
        const result = await prescanSubject({
          base64: body.imageBase64,
          mediaType: body.mediaType,
        });
        return json(res, 200, result);
      } catch (err) {
        return json(res, 502, { error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && req.url === "/api/describe") {
      const body = JSON.parse(await readBody(req));
      const provider = PROVIDERS.find((p) => p.name === body.provider);
      if (!provider) return json(res, 400, { error: "unknown provider" });
      if (!isConfigured(provider))
        return json(res, 400, { error: `${provider.keyEnv} not set` });
      if (!ALLOWED_MEDIA_TYPES.has(body.mediaType))
        return json(res, 400, { error: "unsupported media type" });
      if (typeof body.imageBase64 !== "string" || !body.imageBase64)
        return json(res, 400, { error: "missing image" });

      const prompt =
        typeof body.prompt === "string" && body.prompt.trim()
          ? body.prompt
          : DEFAULT_PROMPT;
      try {
        const result = await describeImage(
          provider,
          { base64: body.imageBase64, mediaType: body.mediaType },
          prompt,
        );
        return json(res, 200, result);
      } catch (err) {
        // Provider-side failure (bad key, rate limit, model gone) — report it
        // in the cell rather than failing the whole run.
        return json(res, 502, { error: String(err.message || err) });
      }
    }

    json(res, 404, { error: "not found" });
  } catch (err) {
    json(res, 500, { error: String(err.message || err) });
  }
});

const active = PROVIDERS.filter(isConfigured).map((p) => p.name);
server.listen(PORT, HOST, () => {
  console.log(
    TOKEN
      ? `vision bake-off UI: http://<this-machine>:${PORT}/?token=${TOKEN}`
      : `vision bake-off UI: http://${HOST}:${PORT}`,
  );
  console.log(
    active.length
      ? `providers with keys: ${active.join(", ")}`
      : "WARNING: no provider keys set — every provider will show as disabled",
  );
});
