// Test-only, dependency-free HTTP helper (node:http, no devDependencies).
//
// Exists because the deploy gate runs the suite against prod-only
// node_modules (`npm ci --omit=dev` in bin/ffc), so tests cannot import
// devDependencies like supertest. And Node's fetch can't replace it here:
// undici strips/forbids the Host header, which tenant-resolution tests must
// set per request.
//
// Starts `app` on an ephemeral 127.0.0.1 port, issues one request with the
// Host header set explicitly, and closes the server before resolving.
import http from "node:http";
import { once } from "node:events";

/**
 * Issue a single request against `app` with an explicit Host header.
 *
 * @param {import("express").Express} app
 * @param {{ method?: string, path: string, host?: string,
 *           headers?: Record<string, string>, body?: any }} opts
 *   `body` objects are JSON-serialized (content-type application/json unless
 *   a content-type header is supplied); strings are sent as-is.
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders,
 *                     body: any, text: string }>}
 *   `text` is the raw response body; `body` is JSON.parse'd when the response
 *   content-type says json (application/json, application/manifest+json, …),
 *   the raw string otherwise.
 */
export async function hostRequest(app, { method = "GET", path, host, headers = {}, body } = {}) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    const payload =
      body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const reqHeaders = { ...(host !== undefined && { host }), ...headers };
    const hasContentType = Object.keys(reqHeaders).some((k) => k.toLowerCase() === "content-type");
    if (payload !== undefined && !hasContentType) {
      reqHeaders["content-type"] = "application/json";
    }
    const res = await new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method: String(method).toUpperCase(),
          path,
          headers: reqHeaders,
          agent: false, // Connection: close — server.close() never waits on a kept-alive socket
        },
        (msg) => {
          const chunks = [];
          msg.on("data", (chunk) => chunks.push(chunk));
          msg.on("end", () =>
            resolve({
              status: msg.statusCode,
              headers: msg.headers,
              text: Buffer.concat(chunks).toString("utf8"),
            })
          );
          msg.on("error", reject);
        }
      );
      req.on("error", reject);
      req.end(payload);
    });
    const isJson = /\bjson\b/i.test(res.headers["content-type"] || "");
    return { ...res, body: isJson && res.text !== "" ? JSON.parse(res.text) : res.text };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
