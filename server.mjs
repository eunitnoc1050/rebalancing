import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const PORT = Number(process.env.PORT || 8080);
const ROOT = process.cwd();
const KRX_AUTH_KEY = process.env.KRX_AUTH_KEY || "";
const KRX_API_URL = process.env.KRX_API_URL || "https://data-dbg.krx.co.kr/svc/apis/etp/etf_bydd_trd";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function writeJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function normalizeCodes(raw) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^[A-Za-z0-9.\-]{1,20}$/.test(s));
}

function firstNumberLike(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const n = Number(value.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function pickField(row, keys) {
  for (const key of keys) {
    if (key in row && row[key] !== undefined && row[key] !== null && row[key] !== "") {
      return row[key];
    }
  }
  return null;
}

function normalizeCode(value) {
  const raw = String(value || "").trim().toUpperCase();
  const compact = raw.replace(/[^A-Z0-9]/g, "");
  if (compact.startsWith("A") && compact.length === 7) return compact.slice(1);
  return compact;
}

function extractPriceMapFromPayload(payload) {
  const rows = Array.isArray(payload?.OutBlock_1) ? payload.OutBlock_1 : [];
  if (!rows || !Array.isArray(rows)) return {};

  // Prefer short 6-digit code first; ISU_CD can be ISIN-like and break matching.
  const codeKeys = ["ISU_SRT_CD", "ISU_CD", "ISUCD", "ISIN_CD", "isuCd", "isu_cd"];
  const closeKeys = ["TDD_CLSPRC", "CLSPRC", "PRC", "tddClsprc", "clsprc", "price", "close"];

  const result = {};
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const code = normalizeCode(pickField(row, codeKeys));
    const closeRaw = pickField(row, closeKeys);
    const close = firstNumberLike(closeRaw);
    if (!code || close === null || close <= 0) continue;
    result[code] = close;
  }
  return result;
}

async function fetchKrPricesByDate(basDd) {
  const requestBody = JSON.stringify({ basDd });
  let r = await fetch(KRX_API_URL, {
    method: "POST",
    headers: {
      AUTH_KEY: KRX_AUTH_KEY,
      auth_key: KRX_AUTH_KEY,
      "Content-Type": "application/json; charset=utf-8",
      Accept: "application/json",
      "User-Agent": "pension-rebalance-cloudrun/1.0"
    },
    body: requestBody
  });

  // Some KRX gateways accept querystring GET instead of JSON POST.
  // Fallback keeps compatibility when upstream routing differs.
  if (!r.ok && [404, 405, 415].includes(r.status)) {
    const qs = new URLSearchParams({ basDd });
    const upstream = `${KRX_API_URL}?${qs.toString()}`;
    r = await fetch(upstream, {
      headers: {
        AUTH_KEY: KRX_AUTH_KEY,
        auth_key: KRX_AUTH_KEY,
        Accept: "application/json",
        "User-Agent": "pension-rebalance-cloudrun/1.0"
      }
    });
  }

  const text = await r.text().catch(() => "");
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!r.ok) {
    throw new Error(`upstream failed with status ${r.status}: ${JSON.stringify(data).slice(0, 300)}`);
  }

  return data;
}

async function handlePriceProxy(req, res, url) {
  if (!KRX_AUTH_KEY) {
    return writeJson(res, 500, { error: "KRX_AUTH_KEY is not configured on server" });
  }

  const codes = normalizeCodes(url.searchParams.get("codes"));
  const basDd = (url.searchParams.get("basDd") || "").trim();

  if (!codes.length) {
    return writeJson(res, 400, { error: "codes query parameter is required" });
  }
  if (!/^\d{8}$/.test(basDd)) {
    return writeJson(res, 400, { error: "basDd query parameter must be YYYYMMDD" });
  }

  try {
    const payload = await fetchKrPricesByDate(basDd);
    const allPrices = extractPriceMapFromPayload(payload);
    const filtered = {};
    const missing = [];
    for (const code of codes) {
      const k = normalizeCode(code);
      if (k in allPrices) {
        filtered[code] = allPrices[k];
      } else {
        missing.push(code);
      }
    }

    return writeJson(res, 200, {
      provider: "KRX",
      basDd,
      requestedCodes: codes,
      matched: Object.keys(filtered).length,
      missingCodes: missing,
      prices: filtered
    });
  } catch (err) {
    return writeJson(res, 502, { error: `upstream request failed: ${err.message}` });
  }
}

async function handleStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safe = normalize(pathname).replace(/^\.\.(\/|\\|$)/, "");
  const file = join(ROOT, safe);

  try {
    const body = await readFile(file);
    const ct = CONTENT_TYPES[extname(file).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, {
      "Content-Type": ct,
      "Cache-Control": "no-cache"
    });
    res.end(body);
  } catch {
    writeJson(res, 404, { error: "not found" });
  }
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/healthz") {
    return writeJson(res, 200, { ok: true });
  }

  if (req.method === "GET" && url.pathname === "/api/prices") {
    return handlePriceProxy(req, res, url);
  }

  if (req.method === "GET") {
    return handleStatic(req, res, url);
  }

  writeJson(res, 405, { error: "method not allowed" });
}).listen(PORT, () => {
  console.log(`Server listening on :${PORT}`);
});
