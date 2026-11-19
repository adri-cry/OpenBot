/**
 * The one gateway between OpenBot and 9router.
 *
 * OpenBot's model list comes from the endpoint's `/v1/models`, so the models are named here as
 * 9router names them (`cx/gpt-6-luna`). OpenBot's own thinking control cannot describe those names:
 * it reads thinking levels from models.dev for the providers it knows, and a custom base URL is
 * `gateway`, which no section describes. So this process does the one thing the server will not:
 * it adds `reasoning.effort` to every model call.
 *
 * It is also where that effort is chosen. `GET`/`POST /effort` are read and written by the Thinking
 * control in OpenBot's composer, which is why they answer CORS from the page's own origin. Nothing
 * else is served: there is no page here to open.
 */
const http = require("node:http");
const fs = require("node:fs");

const TARGET = "http://192.168.1.7:20128";
const CONFIG = process.env.GATEWAY_CONFIG || "/root/openbot/gateway.json";
const LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
const PORT = Number(process.env.GATEWAY_PORT || 20129);

function effort() {
  try {
    const value = JSON.parse(fs.readFileSync(CONFIG, "utf8")).effort;
    return LEVELS.includes(value) ? value : "medium";
  } catch {
    return "medium";
  }
}

function writeEffort(value) {
  const clean = LEVELS.includes(value) ? value : "medium";
  fs.writeFileSync(CONFIG, `${JSON.stringify({ effort: clean }, null, 2)}\n`);
  return clean;
}

function cors(res) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("cache-control", "no-store");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

/** Whether this path is a model call that takes a reasoning effort. */
function takesEffort(pathname) {
  return (
    pathname.endsWith("/chat/completions") || pathname.endsWith("/responses")
  );
}

/** The effort as 9router's OpenAI-compatible surface reads it, for either API shape. */
function withEffort(payload, level) {
  if (!payload || typeof payload !== "object") return payload;
  if (level === "none") {
    // "none" is a real level upstream, not the absence of one: say it rather than drop the field.
    return { ...payload, reasoning: { effort: "none" }, reasoning_effort: "none" };
  }
  return { ...payload, reasoning: { effort: level }, reasoning_effort: level };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === "/effort") {
    if (req.method === "GET") {
      json(res, 200, { effort: effort(), levels: LEVELS });
      return;
    }
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4096) req.destroy();
      });
      req.on("end", () => {
        let next = "";
        try {
          next = String(JSON.parse(body).effort ?? "");
        } catch {
          json(res, 400, { error: "expected a JSON body of { effort }" });
          return;
        }
        if (!LEVELS.includes(next)) {
          json(res, 400, { error: `effort must be one of ${LEVELS.join(", ")}` });
          return;
        }
        const saved = writeEffort(next);
        console.log(JSON.stringify({ type: "gateway-effort", effort: saved }));
        json(res, 200, { effort: saved, levels: LEVELS });
      });
      return;
    }
    json(res, 405, { error: "GET or POST" });
    return;
  }

  if (!pathname.startsWith("/v1/")) {
    json(res, 404, { error: "not found" });
    return;
  }

  const headers = { ...req.headers, host: new URL(TARGET).host };
  delete headers["accept-encoding"];

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
  });
  req.on("end", () => {
    let payload = body;
    if (body && takesEffort(pathname)) {
      try {
        const parsed = JSON.parse(body);
        payload = JSON.stringify(withEffort(parsed, effort()));
      } catch {
        /* A body that is not JSON is forwarded as it came. */
      }
      headers["content-length"] = Buffer.byteLength(payload);
    }

    const upstream = http.request(
      TARGET + req.url,
      { method: req.method, headers },
      (answer) => {
        if (takesEffort(pathname)) {
          console.log(
            JSON.stringify({
              type: "gateway-call",
              path: pathname,
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
        JSON.stringify({ type: "gateway-upstream-failed", message: error.message }),
      );
      cors(res);
      res.writeHead(502, { "content-type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "9router unreachable" }));
    });
    upstream.end(payload);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    JSON.stringify({ type: "gateway-listening", port: PORT, effort: effort() }),
  );
});
