import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function cleanText(value = "") {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeEntities(value = "") {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(parseInt(number, 10)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function pickMeta(html, property) {
  const patterns = [
    new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+name=["']${property}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+name=["']${property}["'][^>]*>`, "i")
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return cleanText(decodeEntities(match[1]));
  }

  return "";
}

function detectType(url) {
  const value = url.toLowerCase();
  if (value.includes("instagram.com")) return "instagram";
  if (value.includes("blog.naver.com")) return "blog";
  if (value.includes("cafe.naver.com")) return "cafe";
  return "other";
}

function extractCaption(value = "") {
  const decoded = cleanText(decodeEntities(value));
  const quoted = decoded.match(/:\s*"([\s\S]+)"\.?$/);
  return cleanText(quoted?.[1] || decoded);
}

function extractBusinessName(value = "") {
  const match = value.match(/(?:가게명|상호|매장명)\s*[:：]\s*([가-힣A-Za-z0-9&._ -]{2,24})/);
  return cleanText(match?.[1] || "");
}

function extractKoreanAddress(value = "") {
  const match = value.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)\s+[가-힣]+(?:시|군|구)?\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?(?:\s*\d+층)?)/);
  return cleanText(match?.[1] || "");
}

function extractKoreanAddresses(value = "") {
  const pattern = /((?:서울|부산|대구|인천|광주|대전|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)\s+[가-힣]+(?:시|군|구)?\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?(?:\s*\d+층)?)/g;
  return [...value.matchAll(pattern)].map((match) => ({
    address: cleanText(match[1]),
    index: match.index || 0
  }));
}

function guessNameNearAddress(value = "", address = "", index = 0) {
  const before = value.slice(Math.max(0, index - 90), index);
  const after = value.slice(index + address.length, index + address.length + 50);
  const explicit = extractBusinessName(`${before} ${after}`);
  if (explicit) return explicit;

  const afterName = after.match(/^\s*([가-힣A-Za-z0-9&._ -]{2,18})(?:\s|#|☎|$)/);
  if (afterName?.[1] && !/(층|호|영업|전화|메뉴)/.test(afterName[1])) return cleanText(afterName[1]);

  const beforeName = before
    .replace(/[#☎⏰🏠➡️]/g, " ")
    .split(/\s+/)
    .filter((part) => /^[가-힣A-Za-z0-9&._-]{2,18}$/.test(part))
    .filter((part) => !/(주소|가게명|상호|매장명|메뉴|카페|맛집|추천|리스트|영업|전화)/.test(part))
    .pop();

  return beforeName || "";
}

function extractPlaceCandidates(caption = "", fallbackUrl = "") {
  const byAddress = extractKoreanAddresses(caption).map(({ address, index }) => {
    const title = guessNameNearAddress(caption, address, index);
    return {
      title: title || address,
      address,
      summary: summarizeCaption(caption, title, address),
      sourceUrl: fallbackUrl
    };
  });

  const deduped = [];
  for (const item of byAddress) {
    const key = `${item.title}|${item.address}`;
    if (!deduped.some((existing) => `${existing.title}|${existing.address}` === key)) deduped.push(item);
  }

  return deduped.slice(0, 25);
}

function extractPhone(value = "") {
  const match = value.match(/\d{2,4}-\d{3,4}-\d{4}/);
  return match?.[0] || "";
}

function extractHours(value = "") {
  const match = value.match(/\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2}(?:[^#☎]{0,40})?/);
  return cleanText(match?.[0] || "");
}

function extractMenu(value = "") {
  const match = value.match(/메뉴\s+(.+?)(?:가게명|상호|매장명|대구|서울|부산|인천|광주|대전|울산|세종|제주|☎|#|$)/);
  return cleanText(match?.[1] || "").slice(0, 120);
}

function summarizeCaption(caption = "", businessName = "", address = "") {
  const phone = extractPhone(caption);
  const hours = extractHours(caption);
  const menu = extractMenu(caption);
  const structured = [
    businessName && `가게명: ${businessName}`,
    address && `주소: ${address}`,
    menu && `메뉴: ${menu}`,
    hours && `영업시간: ${hours}`,
    phone && `전화: ${phone}`
  ].filter(Boolean);

  if (structured.length >= 2) return structured.join("\n");

  return caption
    .replace(/\s*#\S+/g, "")
    .replace(/\s*☎️?\s*\d{2,4}-\d{3,4}-\d{4}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 260);
}

function extractPreview(url, html) {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = pickMeta(html, "og:title") || cleanText(decodeEntities(titleTag?.[1] || ""));
  const rawSummary = pickMeta(html, "og:description") || pickMeta(html, "description");
  const type = detectType(url);
  const caption = type === "instagram" ? extractCaption(rawSummary || rawTitle) : rawSummary;
  const businessName = extractBusinessName(caption);
  const addressCandidate = extractKoreanAddress(caption);
  const placeCandidates = extractPlaceCandidates(caption, url);
  const title = businessName || (type === "instagram" ? extractCaption(rawTitle).slice(0, 36) : rawTitle);
  const summary = type === "instagram" ? summarizeCaption(caption, businessName, addressCandidate) : rawSummary;
  const image = pickMeta(html, "og:image");

  return {
    url,
    title,
    summary,
    businessName,
    addressCandidate,
    placeCandidates,
    image,
    type
  };
}

async function handlePreview(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const target = requestUrl.searchParams.get("url");

  if (!target) {
    sendJson(res, 400, { error: "url is required" });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    sendJson(res, 400, { error: "invalid url" });
    return;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    sendJson(res, 400, { error: "only http and https urls are supported" });
    return;
  }

  try {
    const response = await fetch(parsed.href, {
      headers: {
        "user-agent": "Mozilla/5.0 SNSSpotMap/0.1",
        accept: "text/html,application/xhtml+xml"
      },
      signal: AbortSignal.timeout(9000)
    });

    const html = await response.text();
    sendJson(res, 200, extractPreview(parsed.href, html));
  } catch (error) {
    sendJson(res, 502, { error: "preview fetch failed", message: error.message });
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const safePath = normalize(decodeURIComponent(requestedPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(root, safePath);

  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

createServer((req, res) => {
  if (req.url?.startsWith("/api/link-preview")) {
    handlePreview(req, res);
    return;
  }

  serveStatic(req, res);
}).listen(port, host, () => {
  console.log(`SNS Spot Map running at http://${host}:${port}/`);
});
