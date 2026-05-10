function cleanText(value = "") {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function isBlockedPreviewText(value = "") {
  return [
    /create an account or log in to instagram/i,
    /share what you're into with the people/i,
    /log in to instagram/i,
    /sign up to see photos and videos/i
  ].some((pattern) => pattern.test(String(value)));
}

function safePreviewText(value = "") {
  const text = cleanText(value);
  if (!text || isBlockedPreviewText(text)) return "";
  return text;
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
  return [...value.matchAll(pattern)].map((match) => ({ address: cleanText(match[1]), index: match.index || 0 }));
}

function guessNameNearAddress(value = "", address = "", index = 0) {
  const before = value.slice(Math.max(0, index - 90), index);
  const after = value.slice(index + address.length, index + address.length + 50);
  const explicit = extractBusinessName(`${before} ${after}`);
  if (explicit) return explicit;
  const afterName = after.match(/^\s*([가-힣A-Za-z0-9&._ -]{2,18})(?:\s|#|☎|$)/);
  if (afterName?.[1] && !/(층|호|영업|전화|메뉴)/.test(afterName[1])) return cleanText(afterName[1]);
  return before.replace(/[#☎⏰🏠➡️]/g, " ").split(/\s+/).filter((part) => /^[가-힣A-Za-z0-9&._-]{2,18}$/.test(part)).filter((part) => !/(주소|가게명|상호|매장명|메뉴|카페|맛집|추천|리스트|영업|전화)/.test(part)).pop() || "";
}

function extractPhone(value = "") { return value.match(/\d{2,4}-\d{3,4}-\d{4}/)?.[0] || ""; }
function extractHours(value = "") { return cleanText(value.match(/\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2}(?:[^#☎]{0,40})?/)?.[0] || ""); }
function extractMenu(value = "") { return cleanText(value.match(/메뉴\s+(.+?)(?:가게명|상호|매장명|대구|서울|부산|인천|광주|대전|울산|세종|제주|☎|#|$)/)?.[1] || "").slice(0, 120); }

function summarizeCaption(caption = "", businessName = "", address = "") {
  if (isBlockedPreviewText(caption)) return "";
  const structured = [businessName && `가게명: ${businessName}`, address && `주소: ${address}`, extractMenu(caption) && `메뉴: ${extractMenu(caption)}`, extractHours(caption) && `영업시간: ${extractHours(caption)}`, extractPhone(caption) && `전화: ${extractPhone(caption)}`].filter(Boolean);
  if (structured.length >= 2) return structured.join("\n");
  return safePreviewText(caption.replace(/\s*#\S+/g, "").replace(/\s*☎️?\s*\d{2,4}-\d{3,4}-\d{4}/g, "").replace(/\s+/g, " ").trim()).slice(0, 260);
}

function extractPlaceCandidates(caption = "", fallbackUrl = "") {
  const deduped = [];
  for (const { address, index } of extractKoreanAddresses(caption)) {
    const title = guessNameNearAddress(caption, address, index);
    const item = { title: title || address, address, summary: summarizeCaption(caption, title, address), sourceUrl: fallbackUrl };
    const key = `${item.title}|${item.address}`;
    if (!deduped.some((existing) => `${existing.title}|${existing.address}` === key)) deduped.push(item);
  }
  return deduped.slice(0, 25);
}

function extractPreview(url, html) {
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const rawTitle = pickMeta(html, "og:title") || cleanText(decodeEntities(titleTag?.[1] || ""));
  const rawSummary = pickMeta(html, "og:description") || pickMeta(html, "description");
  const type = detectType(url);
  const caption = type === "instagram" ? extractCaption(rawSummary || rawTitle) : rawSummary;
  const businessName = extractBusinessName(caption);
  const addressCandidate = extractKoreanAddress(caption);
  const title = businessName || safePreviewText(type === "instagram" ? extractCaption(rawTitle).slice(0, 36) : rawTitle);
  const summary = type === "instagram" ? summarizeCaption(caption, businessName, addressCandidate) : safePreviewText(rawSummary);
  return { url, title, summary, businessName, addressCandidate, placeCandidates: extractPlaceCandidates(caption, url), image: pickMeta(html, "og:image"), type };
}

export default async function handler(req, res) {
  const target = req.query?.url;
  if (!target) return res.status(400).json({ error: "url is required" });
  let parsed;
  try { parsed = new URL(target); } catch { return res.status(400).json({ error: "invalid url" }); }
  if (!["http:", "https:"].includes(parsed.protocol)) return res.status(400).json({ error: "only http and https urls are supported" });
  try {
    const response = await fetch(parsed.href, { headers: { "user-agent": "Mozilla/5.0 SNSSpotMap/0.1", accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(9000) });
    res.status(200).json(extractPreview(parsed.href, await response.text()));
  } catch (error) {
    res.status(502).json({ error: "preview fetch failed", message: error.message });
  }
}
