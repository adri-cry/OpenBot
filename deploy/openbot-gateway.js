/**
 * The one gateway between OpenBot and the model endpoints it uses.
 *
 * OpenBot's model list comes from the endpoint's `/v1/models`. Its own thinking control cannot
 * describe a model behind a custom base URL (it reads levels from models.dev), so this process
 * adds `reasoning.effort` to each model call and serves the Thinking control at `/effort`.
 *
 * Endpoints, keys and the visible model list are kept in one config file, edited from Admin →
 * Providers inside OpenBot through `/config`, `/providers` and `/models` below. `/v1/*` is routed
 * to the endpoint that owns the model being called. No other page is served: this is a gateway,
 * not another app.
 */
const http = require("node:http");
const fs = require("node:fs");

const CONFIG = process.env.GATEWAY_CONFIG || "/root/openbot/gateway.json";
const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const PORT = Number(process.env.GATEWAY_PORT || 20129);

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.writeFileSync(CONFIG, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(CONFIG, 0o600);
}

function providers(config) {
  return Array.isArray(config.providers) ? config.providers : [];
}

function effort() {
  const value = readConfig().effort;
  return LEVELS.includes(value) ? value : "medium";
}

function modelAllowlist() {
  const value = readConfig().models;
  return Array.isArray(value) ? value.filter((id) => typeof id === "string" && id) : [];
}

function mask(key) {
  if (!key || typeof key !== "string") return "";
  return key.length <= 8 ? "••••" : `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function publicConfig(config) {
  return {
    effort: LEVELS.includes(config.effort) ? config.effort : "medium",
    models: modelAllowlist(),
    providers: providers(config).map((p) => ({
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      apiKey: mask(p.apiKey),
      prefixes: Array.isArray(p.prefixes) ? p.prefixes : [],
    })),
  };
}

/** The endpoint that serves a model: first whose prefix matches, else the first one. */
function owner(config, model) {
  const list = providers(config);
  const prefix = String(model || "").split("/")[0];
  return list.find((p) => (p.prefixes || []).includes(prefix)) || list[0] || null;
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("cache-control", "no-store");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req, res, limit, done) {
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > limit) req.destroy();
  });
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body || "{}");
    } catch {
      json(res, 400, { error: "expected a JSON object" });
      return;
    }
    done(parsed);
  });
}

function takesEffort(pathname) {
  return pathname.endsWith("/chat/completions") || pathname.endsWith("/responses");
}

function withEffort(payload, level) {
  if (!payload || typeof payload !== "object") return payload;
  if (level === "none") {
    return { ...payload, reasoning: { effort: "none" }, reasoning_effort: "none" };
  }
  return { ...payload, reasoning: { effort: level }, reasoning_effort: level };
}

/** Ask every configured endpoint for its models, then keep only the allowed ids. */
async function catalogue(config) {
  const allowed = modelAllowlist();
  const seen = new Map();
  await Promise.all(
    providers(config).map(
      (p) =>
        new Promise((resolve) => {
          let url;
          try {
            url = new URL("/v1/models", String(p.baseUrl).replace(/\/$/, ""));
          } catch {
            resolve();
            return;
          }
          const headers = p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {};
          http
            .request(
              url,
              { method: "GET", headers },
              (answer) => {
                let raw = "";
                answer.setEncoding("utf8");
                answer.on("data", (chunk) => {
                  raw += chunk;
                });
                answer.on("end", () => {
                  try {
                    const body = JSON.parse(raw);
                    for (const model of body.data || []) {
                      if (model && model.id && !seen.has(model.id)) seen.set(model.id, model);
                    }
                  } catch {
                    console.log(
                      JSON.stringify({ type: "gateway-catalogue-unreadable", provider: p.id }),
                    );
                  }
                  resolve();
                });
              },
            )
            .on("error", () => {
              console.log(JSON.stringify({ type: "gateway-catalogue-failed", provider: p.id }));
              resolve();
            })
            .end();
        }),
    ),
  );
  const all = [...seen.values()];
  return allowed.length ? all.filter((m) => allowed.includes(m.id)) : all;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname;
  const method = req.method;

  if (method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ---- The settings OpenBot talks to -------------------------------------------------------

  if (pathname === "/config" && method === "GET") {
    json(res, 200, publicConfig(readConfig()));
    return;
  }

  if (pathname === "/effort" && method === "GET") {
    json(res, 200, { effort: effort(), levels: LEVELS });
    return;
  }

  if (pathname === "/effort" && method === "POST") {
    readBody(req, res, 4096, (body) => {
      const next = String(body.effort ?? "");
      if (!LEVELS.includes(next)) {
        json(res, 400, { error: `effort must be one of ${LEVELS.join(", ")}` });
        return;
      }
      const config = readConfig();
      config.effort = next;
      writeConfig(config);
      console.log(JSON.stringify({ type: "gateway-effort", effort: next }));
      json(res, 200, publicConfig(config));
    });
    return;
  }

  if (pathname === "/models" && method === "PATCH") {
    readBody(req, res, 65536, (body) => {
      if (!Array.isArray(body.models) || !body.models.every((m) => typeof m === "string")) {
        json(res, 400, { error: "models must be an array of ids" });
        return;
      }
      const config = readConfig();
      config.models = [...new Set(body.models.map((m) => m.trim()).filter(Boolean))];
      writeConfig(config);
      console.log(JSON.stringify({ type: "gateway-models", count: config.models.length }));
      json(res, 200, publicConfig(config));
    });
    return;
  }

  if (pathname === "/providers" && method === "POST") {
    readBody(req, res, 16384, (body) => {
      const name = String(body.name || "").trim();
      const baseUrl = String(body.baseUrl || "").trim();
      if (!name || !/^https?:\/\//.test(baseUrl)) {
        json(res, 400, { error: "name and an http(s) baseUrl are required" });
        return;
      }
      const config = readConfig();
      const list = providers(config);
      const id = `p${Date.now().toString(36)}`;
      list.push({
        id,
        name,
        baseUrl: baseUrl.replace(/\/$/, ""),
        apiKey: String(body.apiKey || ""),
        prefixes: Array.isArray(body.prefixes)
          ? body.prefixes.filter((p) => typeof p === "string" && p)
          : [],
      });
      config.providers = list;
      writeConfig(config);
      console.log(JSON.stringify({ type: "gateway-provider-added", id, name }));
      json(res, 201, publicConfig(config));
    });
    return;
  }

  const providerMatch = pathname.match(/^\/providers\/([^/]+)$/);
  if (providerMatch) {
    const id = decodeURIComponent(providerMatch[1]);
    if (method === "PATCH") {
      readBody(req, res, 16384, (body) => {
        const config = readConfig();
        const list = providers(config);
        const index = list.findIndex((p) => p.id === id);
        if (index < 0) {
          json(res, 404, { error: "no such provider" });
          return;
        }
        const current = list[index];
        if (body.name !== undefined) current.name = String(body.name).trim();
        if (body.baseUrl !== undefined) {
          const value = String(body.baseUrl).trim().replace(/\/$/, "");
          if (!/^https?:\/\//.test(value)) {
            json(res, 400, { error: "baseUrl must be http(s)" });
            return;
          }
          current.baseUrl = value;
        }
        // An empty key in the form means "keep the one already saved".
        if (body.apiKey) current.apiKey = String(body.apiKey);
        if (Array.isArray(body.prefixes)) {
          current.prefixes = body.prefixes.filter((p) => typeof p === "string" && p);
        }
        list[index] = current;
        config.providers = list;
        writeConfig(config);
        console.log(JSON.stringify({ type: "gateway-provider-updated", id }));
        json(res, 200, publicConfig(config));
      });
      return;
    }
    if (method === "DELETE") {
      const config = readConfig();
      const list = providers(config).filter((p) => p.id !== id);
      config.providers = list;
      writeConfig(config);
      console.log(JSON.stringify({ type: "gateway-provider-deleted", id }));
      json(res, 200, publicConfig(config));
      return;
    }
  }

  if (!pathname.startsWith("/v1/")) {
    json(res, 404, { error: "not found" });
    return;
  }

  if (pathname === "/v1/models" && method === "GET") {
    catalogue(readConfig())
      .then((data) => json(res, 200, { object: "list", data }))
      .catch(() => json(res, 502, { error: "model endpoints unreachable" }));
    return;
  }

  // ---- Model calls --------------------------------------------------------------------------

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    const config = readConfig();
    let payload = body;
    let model = "";
    if (body) {
      try {
        const parsed = JSON.parse(body);
        model = String(parsed.model || "");
        if (takesEffort(pathname)) payload = JSON.stringify(withEffort(parsed, effort()));
      } catch {
        /* Not JSON: forward it unchanged. */
      }
    }

    const endpoint = owner(config, model);
    if (!endpoint) {
      json(res, 503, { error: "no model endpoint configured" });
      return;
    }

    let target;
    try {
      target = new URL(req.url || "/", String(endpoint.baseUrl).replace(/\/$/, ""));
    } catch {
      json(res, 503, { error: `${endpoint.name} has an invalid baseUrl` });
      return;
    }

    const headers = { ...req.headers, host: target.host };
    delete headers["accept-encoding"];
    if (endpoint.apiKey) headers.authorization = `Bearer ${endpoint.apiKey}`;
    if (body && takesEffort(pathname)) headers["content-length"] = Buffer.byteLength(payload);

    const upstream = http.request(
      target,
      { method, headers },
      (answer) => {
        if (takesEffort(pathname)) {
          console.log(
            JSON.stringify({
              type: "gateway-call",
              provider: endpoint.id,
              model,
              effort: effort(),
              status: answer.statusCode,
            }),
          );
        }
        res.writeHead(answer.statusCode || 502, {
          ...answer.headers,
          "access-control-allow-origin": "*",
        });
        answer.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      console.error(
        JSON.stringify({
          type: "gateway-upstream-failed",
          provider: endpoint.id,
          message: error.message,
        }),
      );
      json(res, 502, { error: `${endpoint.name} unreachable` });
    });
    upstream.end(payload);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  const config = readConfig();
  console.log(
    JSON.stringify({
      type: "gateway-listening",
      port: PORT,
      effort: effort(),
      providers: providers(config).map((p) => p.id),
      models: modelAllowlist().length,
    }),
  );
});
