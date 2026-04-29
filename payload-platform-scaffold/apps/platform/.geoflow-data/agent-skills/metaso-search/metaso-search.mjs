#!/usr/bin/env node
/**
 * 秘塔搜索 — 通过 MCP API 直接调用 metaso_web_search
 *
 * 用法:
 *   node metaso-search.mjs "搜索关键词"
 *   node metaso-search.mjs "关键词" --size 3
 *   node metaso-search.mjs "关键词" --scope paper --summary
 *   node metaso-search.mjs "关键词" --raw
 *   node metaso-search.mjs "关键词" --recency-days 7 --json
 */

import https from "node:https";

const MCP_URL = "https://metaso.cn/api/mcp";
const AUTH_TOKEN =
  process.env.METASO_AUTH_TOKEN || "mk-A2B693BB6A342D3E75636C0B4CBE8F24";
const VALID_SCOPES = ["webpage", "document", "paper", "image", "video", "podcast"];

function printHelp() {
  console.log(`秘塔搜索 — 通过 MCP API 调用 metaso_web_search

用法:
  node metaso-search.mjs "搜索关键词"

参数:
  --scope <scope>         搜索范围 (默认: webpage)
                          可选: webpage|document|paper|image|video|podcast
  --size <n>              返回数量 (默认: 20)
  --summary               包含摘要
  --recency-days <n>      最近几天范围 (天为单位)
  --raw                   输出原始 JSON
  --json                  输出 JSON（用于脚本消费）
  -h, --help              显示帮助
`);
}

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = {
    query: "",
    scope: "webpage",
    size: 20,
    summary: false,
    rawContent: false,
    recencyDays: undefined,
    raw: false,
    json: false,
    help: false,
  };

  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "-h" || arg === "--help") {
      opts.help = true;
      continue;
    }

    if (arg === "--summary") {
      opts.summary = true;
      continue;
    }

    if (arg === "--raw") {
      opts.raw = true;
      continue;
    }

    if (arg === "--json") {
      opts.json = true;
      continue;
    }

    if (arg === "--scope") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        fail("--scope 需要一个值");
      }
      opts.scope = value;
      i += 1;
      continue;
    }

    if (arg === "--size") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        fail("--size 必须是正整数");
      }
      opts.size = value;
      i += 1;
      continue;
    }

    if (arg === "--recency-days") {
      const value = Number(argv[i + 1]);
      if (!Number.isInteger(value) || value <= 0) {
        fail("--recency-days 必须是正整数");
      }
      opts.recencyDays = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      fail(`未知参数: ${arg}`);
    }

    positional.push(arg);
  }

  if (positional.length > 0) {
    opts.query = positional.join(" ");
  }

  if (!VALID_SCOPES.includes(opts.scope)) {
    fail(`--scope 必须是以下之一: ${VALID_SCOPES.join(" | ")}`);
  }

  return opts;
}

function httpPostJson(url, payload, headers = {}) {
  const u = new URL(url);
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || undefined,
        path: `${u.pathname}${u.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
          ...headers,
        },
      },
      (res) => {
        let chunks = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          chunks += chunk;
        });
        res.on("end", () => {
          const status = res.statusCode || 0;
          const contentType = String(res.headers["content-type"] || "");
          resolve({ status, contentType, body: chunks });
        });
      },
    );

    req.on("error", (err) => {
      reject(err);
    });

    req.setTimeout(60000, () => {
      req.destroy(new Error("请求超时 (60s)"));
    });

    req.write(body);
    req.end();
  });
}

async function callTool(toolName, argumentsObject) {
  const payload = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: toolName,
      arguments: argumentsObject,
    },
  };

  let response;
  try {
    response = await httpPostJson(MCP_URL, payload, {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      Accept: "application/json, text/event-stream",
    });
  } catch (error) {
    fail(`Network Error: ${error.message}`);
  }

  if (response.status < 200 || response.status >= 300) {
    fail(`HTTP ${response.status}: ${response.body.slice(0, 500)}`);
  }

  if (response.contentType.includes("text/event-stream")) {
    let result = {};
    const lines = response.body.split(/\r?\n/);

    for (const line of lines) {
      if (!line.startsWith("data: ")) {
        continue;
      }

      const data = line.slice(6).trim();
      if (!data) {
        continue;
      }

      try {
        const event = JSON.parse(data);
        if (event.result) {
          result = event.result;
        }
      } catch {
        // 忽略非 JSON 事件
      }
    }

    return result;
  }

  let respJson;
  try {
    respJson = JSON.parse(response.body);
  } catch {
    fail(`返回内容不是合法 JSON: ${response.body.slice(0, 500)}`);
  }

  if (respJson.error) {
    fail(`MCP Error: ${JSON.stringify(respJson.error, null, 2)}`);
  }

  return respJson.result || {};
}

async function search({ query, scope, size, summary, rawContent, recencyDays }) {
  const argumentsObject = {
    q: query,
    scope,
    size,
    includeSummary: summary,
    includeRawContent: rawContent,
  };

  if (typeof recencyDays === "number") {
    argumentsObject.recencyDays = recencyDays;
  }

  return callTool("metaso_web_search", argumentsObject);
}

function printResults(result) {
  const contents = Array.isArray(result.content) ? result.content : [];
  if (contents.length === 0) {
    console.log("（无结果）");
    return;
  }

  for (const item of contents) {
    if (item?.type !== "text") {
      continue;
    }

    let data;
    try {
      data = JSON.parse(item.text);
    } catch {
      console.log(String(item.text || "").slice(0, 500));
      return;
    }

    const webpages = Array.isArray(data.webpages) ? data.webpages : [];
    const total = data.total ?? 0;

    if (webpages.length === 0) {
      console.log("（无结果）");
      return;
    }

    console.log(`  共 ${total} 条，显示 ${webpages.length} 条：  \n`);

    webpages.forEach((r, idx) => {
      const title = r.title || "无标题";
      const url = r.link || "";
      let snippet = r.snippet || "";
      const date = r.date || "";
      const score = r.score || "";

      console.log(`  【${idx + 1}】${title}`);
      if (url) {
        console.log(`      🔗 ${url}`);
      }

      const meta = [];
      if (date) {
        meta.push(`📅 ${date}`);
      }
      if (score) {
        meta.push(`⚡ ${score}`);
      }
      if (meta.length > 0) {
        console.log(`      ${meta.join("  ")}`);
      }

      if (snippet) {
        if (snippet.length > 200) {
          snippet = `${snippet.slice(0, 200)}...`;
        }
        console.log(`      ${snippet}`);
      }

      console.log("");
    });

    return;
  }

  console.log("（无结果）");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.query) {
    printHelp();
    if (!args.query && !args.help) {
      process.exitCode = 1;
    }
    return;
  }

  const result = await search(args);

  if (args.json || args.raw) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`🔍 ${args.query} (scope=${args.scope}, size=${args.size})\n`);
  printResults(result);
}

main().catch((error) => {
  fail(error?.message || String(error));
});
