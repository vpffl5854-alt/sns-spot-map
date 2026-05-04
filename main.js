const config = window.SNS_MAP_CONFIG || {};
const $ = (selector) => document.querySelector(selector);

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

const typeLabels = { instagram: "Instagram", blog: "Naver Blog", cafe: "Naver Cafe", other: "기타" };
const typeClass = { instagram: "pin-instagram", blog: "pin-blog", cafe: "pin-cafe", other: "pin-other" };
const categoryLabels = { korean: "한식", chinese: "중식", japanese: "일식", western: "양식", cafe: "카페", bakery: "빵", bar: "술집", other: "기타" };
const categoryIcons = { korean: "한", chinese: "중", japanese: "일", western: "양", cafe: "카", bakery: "빵", bar: "술", other: "기" };
const categoryKeywords = {
  korean: ["한식", "국밥", "갈비", "삼겹", "김치", "탕", "찌개", "냉면", "곱창", "닭갈비"],
  chinese: ["중식", "중국", "짜장", "짬뽕", "탕수", "마라", "딤섬", "양꼬치", "훠궈"],
  japanese: ["일식", "초밥", "스시", "라멘", "우동", "돈카츠", "돈까스", "오마카세", "이자카야"],
  western: ["양식", "파스타", "스테이크", "피자", "버거", "리조또", "브런치"],
  cafe: ["카페", "커피", "라떼", "디저트", "빙수"],
  bakery: ["빵", "베이커리", "소금빵", "크루아상", "케이크", "도넛", "쿠키"],
  bar: ["술집", "맥주", "와인", "포차", "주점", "막걸리", "칵테일"]
};

let map = null;
let markers = [];
let userLocationMarker = null;
let spots = [];
let activeFilter = "all";
let activeSpotId = null;
let editingSpotId = null;
let placeCandidates = [];
let installPromptEvent = null;

const els = {
  map: $("#map"), fallbackMap: $("#fallbackMap"), fallbackPins: $("#fallbackPins"), status: $("#status"),
  selectedType: $("#selectedType"), selectedTitle: $("#selectedTitle"), selectedMeta: $("#selectedMeta"), selectedSummary: $("#selectedSummary"), selectedLink: $("#selectedLink"),
  relatedList: $("#relatedList"), locateButton: $("#locateButton"), installButton: $("#installButton"), composer: $("#composer"), form: $("#spotForm"),
  composerTitle: $("#composerTitle"), submitSpotButton: $("#submitSpotButton"), candidateSection: $("#candidateSection"), candidateTitle: $("#candidateTitle"), candidateList: $("#candidateList")
};

function sampleSpots() {
  return [{ id: crypto.randomUUID(), title: "샘플 카페", type: "instagram", category: "cafe", address: "서울 성동구 성수동", lat: 37.5446, lng: 127.0557, url: "https://www.instagram.com/", summary: "DB가 비어 있을 때 보이는 샘플입니다.", createdAt: new Date().toISOString().slice(0, 10) }];
}
function setStatus(message) { els.status.textContent = message; }
function escapeHtml(value = "") { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function hasDb() { return Boolean(config.supabaseUrl && config.supabaseAnonKey); }
function endpoint(path = "") { return `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/${config.supabaseTable || "spots"}${path}`; }
function headers(extra = {}) { return { apikey: config.supabaseAnonKey, authorization: `Bearer ${config.supabaseAnonKey}`, "content-type": "application/json", ...extra }; }
function normalizeSpot(row) { return { id: row.id, title: row.title, type: row.type || "other", category: row.category || "other", address: row.address, lat: Number(row.lat), lng: Number(row.lng), url: row.url, summary: row.summary || "", createdAt: row.created_at || row.createdAt || new Date().toISOString().slice(0, 10) }; }
function detectType(url = "") { const v = url.toLowerCase(); if (v.includes("instagram.com")) return "instagram"; if (v.includes("blog.naver.com")) return "blog"; if (v.includes("cafe.naver.com")) return "cafe"; return "other"; }
function detectCategory(...values) { const text = values.filter(Boolean).join(" ").toLowerCase(); for (const [key, words] of Object.entries(categoryKeywords)) if (words.some((word) => text.includes(word.toLowerCase()))) return key; return "other"; }
function filteredSpots() { return activeFilter === "all" ? spots : spots.filter((spot) => spot.type === activeFilter); }
function samePlace(a, b) { if (!a || !b || a.id === b.id) return false; const sameAddress = a.address?.trim() && a.address.trim() === b.address?.trim(); const close = Math.abs(a.lat - b.lat) < 0.00025 && Math.abs(a.lng - b.lng) < 0.00025; return sameAddress || (a.title === b.title && close); }

async function loadRemoteSpots() { const res = await fetch(endpoint("?select=*&order=created_at.desc"), { headers: headers() }); if (!res.ok) throw new Error(`load ${res.status}`); return (await res.json()).map(normalizeSpot); }
async function createRemoteSpot(spot) { const payload = { id: spot.id, title: spot.title, type: spot.type, category: spot.category, address: spot.address, lat: spot.lat, lng: spot.lng, url: spot.url, summary: spot.summary }; const res = await fetch(endpoint(), { method: "POST", headers: headers({ prefer: "return=representation" }), body: JSON.stringify(payload) }); if (!res.ok) throw new Error(`save ${res.status}`); return normalizeSpot((await res.json())[0]); }
async function updateRemoteSpot(spot) { const payload = { title: spot.title, type: spot.type, category: spot.category, address: spot.address, lat: spot.lat, lng: spot.lng, url: spot.url, summary: spot.summary }; const res = await fetch(endpoint(`?id=eq.${encodeURIComponent(spot.id)}`), { method: "PATCH", headers: headers({ prefer: "return=representation" }), body: JSON.stringify(payload) }); if (!res.ok) throw new Error(`update ${res.status}`); return normalizeSpot((await res.json())[0]); }
async function deleteRemoteSpot(id) { const res = await fetch(endpoint(`?id=eq.${encodeURIComponent(id)}`), { method: "DELETE", headers: headers() }); if (!res.ok) throw new Error(`delete ${res.status}`); }
async function saveSpot(spot) { const saved = hasDb() ? await createRemoteSpot(spot) : spot; spots = [saved, ...spots]; localStorage.setItem("sns-map-spots", JSON.stringify(spots)); return saved; }
async function updateSpot(spot) { const saved = hasDb() ? await updateRemoteSpot(spot) : normalizeSpot(spot); spots = spots.map((item) => item.id === saved.id ? saved : item); localStorage.setItem("sns-map-spots", JSON.stringify(spots)); return saved; }
async function removeSpot(id) { if (hasDb()) await deleteRemoteSpot(id); spots = spots.filter((spot) => spot.id !== id); localStorage.setItem("sns-map-spots", JSON.stringify(spots)); }

function extractBusinessName(text = "") { return text.match(/(?:가게명|상호|매장명)\s*[:：]\s*([가-힣A-Za-z0-9&._ -]{2,24})/)?.[1]?.trim() || ""; }
function extractKoreanAddress(text = "") { return text.match(/((?:서울|부산|대구|인천|광주|대전|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)\s+[가-힣]+(?:시|군|구)?\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?(?:\s*\d+층)?)/)?.[1]?.trim() || ""; }
function extractKoreanAddresses(text = "") { const pattern = /((?:서울|부산|대구|인천|광주|대전|울산|세종|제주|경기|강원|충북|충남|전북|전남|경북|경남)\s+[가-힣]+(?:시|군|구)?\s+[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?(?:\s*\d+층)?)/g; return [...text.matchAll(pattern)].map((m) => ({ address: m[1].trim(), index: m.index || 0 })); }
function guessNameNearAddress(text, address, index) { const before = text.slice(Math.max(0, index - 80), index); const after = text.slice(index + address.length, index + address.length + 40); const explicit = extractBusinessName(`${before} ${after}`); if (explicit) return explicit; const afterName = after.match(/^\s*([가-힣A-Za-z0-9&._ -]{2,18})(?:\s|#|☎|$)/); if (afterName?.[1] && !/(층|호|영업|전화|메뉴)/.test(afterName[1])) return afterName[1].trim(); return before.replace(/[#☎⏰🏠➡️📍▶◀]/g, " ").split(/\s+/).filter((part) => /^[가-힣A-Za-z0-9&._-]{2,18}$/.test(part)).filter((part) => !/(주소|가게명|상호|매장명|메뉴|카페|맛집|추천|리스트|영업|전화)/.test(part)).pop() || ""; }
function candidatesFromText(text = "") { const out = []; for (const { address, index } of extractKoreanAddresses(text)) { const title = guessNameNearAddress(text, address, index) || address; const key = `${title}|${address}`; if (!out.some((item) => `${item.title}|${item.address}` === key)) out.push({ title, address, category: detectCategory(title, text), summary: `가게명: ${title}\n주소: ${address}` }); } return out.slice(0, 30); }

function renderCandidates(candidates = []) { placeCandidates = candidates.map((c, i) => ({ id: `candidate-${Date.now()}-${i}`, title: c.title || c.address || `장소 ${i + 1}`, address: c.address || "", summary: c.summary || "", category: c.category || detectCategory(c.title, c.address, c.summary) })); els.candidateSection.hidden = placeCandidates.length === 0; els.candidateTitle.textContent = `${placeCandidates.length}개 후보`; els.candidateList.innerHTML = placeCandidates.map((c) => `<label class="candidate-item"><input type="checkbox" data-candidate-id="${c.id}" checked><span><strong>${escapeHtml(c.title)}</strong><small>${escapeHtml(c.address || "주소 후보 없음")} · ${categoryLabels[c.category] || "기타"}</small></span></label>`).join(""); }
function searchPlace(keyword) { return new Promise((resolve) => { if (!window.kakao?.maps?.services?.Places) return resolve(null); new kakao.maps.services.Places().keywordSearch(keyword, (result, status) => resolve(status === kakao.maps.services.Status.OK && result?.length ? result[0] : null)); }); }
async function fillPlaceFromText(...values) { const joined = values.filter(Boolean).join(" "); const address = extractKoreanAddress(joined); const name = extractBusinessName(joined); const keywords = [address && name ? `${address} ${name}` : "", address, name].filter(Boolean); for (const keyword of [...new Set(keywords)]) { const place = await searchPlace(keyword); if (!place) continue; $("#addressInput").value = place.road_address_name || place.address_name || place.place_name; $("#latInput").value = Number(place.y).toFixed(6); $("#lngInput").value = Number(place.x).toFixed(6); setStatus(`${place.place_name} 위치를 자동 입력했습니다.`); return true; } return false; }
async function resolveCandidate(c) { for (const keyword of [c.address && c.title ? `${c.address} ${c.title}` : "", c.address, c.title].filter(Boolean)) { const place = await searchPlace(keyword); if (place) return { ...c, title: c.title || place.place_name, address: place.road_address_name || place.address_name || c.address, lat: Number(place.y), lng: Number(place.x) }; } return null; }

function renderFallbackPins() { els.fallbackPins.innerHTML = filteredSpots().map((spot) => { const x = Math.max(7, Math.min(93, ((spot.lng - 126.2) / 1.2) * 100)); const y = Math.max(8, Math.min(85, (1 - (spot.lat - 33.1) / 4.8) * 100)); return `<button class="fallback-pin cat-${spot.category || "other"} ${spot.id === activeSpotId ? "active" : ""}" type="button" data-id="${spot.id}" style="left:${x}%;top:${y}%" aria-label="${escapeHtml(spot.title)}"><span>${categoryIcons[spot.category] || "기"}</span></button>`; }).join(""); }
function clearMarkers() { markers.forEach((marker) => marker.setMap(null)); markers = []; }
function renderKakaoMarkers() { if (!map || !window.kakao) return; clearMarkers(); const bounds = new kakao.maps.LatLngBounds(); filteredSpots().forEach((spot) => { const position = new kakao.maps.LatLng(spot.lat, spot.lng); markers.push(new kakao.maps.CustomOverlay({ map, position, yAnchor: 1, content: `<button class="kakao-category-marker cat-${spot.category || "other"}" type="button" data-marker-id="${spot.id}" title="${escapeHtml(spot.title)}">${categoryIcons[spot.category] || "기"}</button>` })); bounds.extend(position); }); if (markers.length > 1) map.setBounds(bounds); if (markers.length === 1) map.setCenter(new kakao.maps.LatLng(filteredSpots()[0].lat, filteredSpots()[0].lng)); }
function renderPins() { renderFallbackPins(); renderKakaoMarkers(); setStatus(`${filteredSpots().length}개 위치 · ${config.kakaoJavaScriptKey ? "Kakao Map" : "Demo Map"} · ${hasDb() ? "DB" : "Browser"}`); selectSpot(activeSpotId); }
function selectSpot(id) { const spot = spots.find((item) => item.id === id) || filteredSpots()[0]; if (!spot) return; activeSpotId = spot.id; els.selectedType.textContent = typeLabels[spot.type] || "SNS"; els.selectedTitle.textContent = spot.title; els.selectedMeta.textContent = `${categoryLabels[spot.category] || "기타"} · ${spot.address} · ${spot.createdAt}`; els.selectedSummary.textContent = spot.summary || "요약이 없습니다."; els.selectedLink.href = spot.url; const related = spots.filter((item) => samePlace(spot, item)); els.relatedList.innerHTML = related.length ? related.map((item) => `<button class="related-item" type="button" data-related-id="${item.id}"><span class="badge ${typeClass[item.type]}">${typeLabels[item.type]}</span><span class="category-chip">${categoryLabels[item.category] || "기타"}</span><span>${escapeHtml(item.title)}</span></button>`).join("") : "<p class=\"empty-state\">같은 위치에 연결된 다른 링크가 아직 없습니다.</p>"; }

function loadKakaoMap() { return new Promise((resolve, reject) => { if (!config.kakaoJavaScriptKey) return reject(new Error("missing-key")); if (window.kakao?.maps?.Map) return resolve(); const timeout = setTimeout(() => reject(new Error("kakao-timeout")), 8000); const script = document.createElement("script"); script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${config.kakaoJavaScriptKey}&autoload=false&libraries=services`; script.onload = () => kakao.maps.load(() => { clearTimeout(timeout); resolve(); }); script.onerror = () => { clearTimeout(timeout); reject(new Error("kakao-load-failed")); }; document.head.appendChild(script); }); }
async function initMap() { try { await loadKakaoMap(); els.fallbackMap.hidden = true; els.map.hidden = false; map = new kakao.maps.Map(els.map, { center: new kakao.maps.LatLng(37.5446, 127.0557), level: 8 }); } catch (error) { console.warn(error); els.map.hidden = true; els.fallbackMap.hidden = false; } renderPins(); }
function setComposerMode(mode, spot = null) { editingSpotId = mode === "edit" ? spot?.id : null; els.composerTitle.textContent = mode === "edit" ? "장소 정보 수정" : "링크와 위치 등록"; els.submitSpotButton.textContent = mode === "edit" ? "수정 저장" : "지도에 추가"; renderCandidates([]); if (mode !== "edit" || !spot) { els.form.reset(); $("#categoryInput").value = "other"; return; } $("#urlInput").value = spot.url || ""; $("#titleInput").value = spot.title || ""; $("#typeInput").value = spot.type || "other"; $("#categoryInput").value = spot.category || "other"; $("#addressInput").value = spot.address || ""; $("#latInput").value = Number(spot.lat).toFixed(6); $("#lngInput").value = Number(spot.lng).toFixed(6); $("#summaryInput").value = spot.summary || ""; }

async function analyzeLink() { const url = $("#urlInput").value.trim(); if (!url) return setStatus("분석할 링크를 먼저 입력하세요."); $("#typeInput").value = detectType(url); setStatus("링크를 분석 중입니다."); try { const res = await fetch(`${config.linkPreviewEndpoint || "/api/link-preview"}?url=${encodeURIComponent(url)}`); const preview = await res.json(); if (!res.ok) throw new Error(preview.error || "preview failed"); if (preview.title) $("#titleInput").value = preview.title; if (preview.summary) $("#summaryInput").value = preview.summary; if (preview.type) $("#typeInput").value = preview.type; $("#categoryInput").value = detectCategory(preview.title, preview.summary, preview.businessName); renderCandidates(preview.placeCandidates || []); if (preview.addressCandidate) $("#addressInput").value = preview.addressCandidate; const filled = await fillPlaceFromText(preview.addressCandidate, preview.businessName, preview.title, preview.summary); if (!filled) setStatus("제목과 요약을 자동 입력했습니다. 주소는 확인해 주세요."); } catch (error) { console.warn(error); setStatus("자동 분석이 막혔습니다. 직접 입력하면 저장할 수 있습니다."); } }
async function saveSelectedCandidates() { const url = $("#urlInput").value.trim(); const type = $("#typeInput").value; const checked = [...els.candidateList.querySelectorAll("input:checked")].map((input) => input.dataset.candidateId); const selected = placeCandidates.filter((c) => checked.includes(c.id)); if (!selected.length) return setStatus("저장할 후보를 선택하세요."); let saved = 0; let failed = 0; for (const c of selected) { const resolved = await resolveCandidate(c); if (!resolved) { failed += 1; continue; } const spot = await saveSpot({ id: crypto.randomUUID(), url, title: resolved.title, type, category: resolved.category || detectCategory(resolved.title, resolved.summary), address: resolved.address, lat: resolved.lat, lng: resolved.lng, summary: resolved.summary || c.summary, createdAt: new Date().toISOString().slice(0, 10) }); activeSpotId = spot.id; saved += 1; } renderPins(); setStatus(`${saved}개 저장 완료${failed ? ` · ${failed}개 실패` : ""}`); }
async function deleteActiveSpot() { const spot = spots.find((item) => item.id === activeSpotId); if (!spot) return setStatus("삭제할 항목이 없습니다."); if (!confirm(`${spot.title} 항목을 삭제할까요? DB에서도 삭제됩니다.`)) return; try { await removeSpot(spot.id); activeSpotId = spots[0]?.id || null; renderPins(); setStatus("삭제됐습니다."); } catch (error) { console.warn(error); setStatus("삭제 권한 또는 DB 연결을 확인해 주세요."); } }
function geocodeAddress() { const address = $("#addressInput").value.trim(); if (!address) return setStatus("주소나 장소명을 먼저 입력하세요."); if (!window.kakao?.maps?.services) return setStatus("카카오맵 장소 검색 준비가 아직 안 됐습니다."); new kakao.maps.services.Geocoder().addressSearch(address, (result, status) => { if (status !== kakao.maps.services.Status.OK || !result[0]) return setStatus("좌표를 찾지 못했습니다. 주소를 조금 더 자세히 입력해 주세요."); $("#latInput").value = Number(result[0].y).toFixed(6); $("#lngInput").value = Number(result[0].x).toFixed(6); setStatus("좌표를 찾았습니다."); }); }
function moveToCurrentLocation() { if (!navigator.geolocation) return setStatus("현재 위치를 사용할 수 없습니다."); setStatus("현재 위치를 확인 중입니다."); navigator.geolocation.getCurrentPosition((pos) => { if (!map || !window.kakao) return; if (userLocationMarker) userLocationMarker.setMap(null); const position = new kakao.maps.LatLng(pos.coords.latitude, pos.coords.longitude); userLocationMarker = new kakao.maps.CustomOverlay({ map, position, yAnchor: 0.5, xAnchor: 0.5, content: "<div class=\"user-location-marker\" title=\"현재 위치\"></div>" }); map.setCenter(position); map.setLevel(5); setStatus("현재 위치로 이동했습니다."); }, () => setStatus("현재 위치 권한이 필요합니다."), { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }); }

function bindEvents() {
  $("#openComposer").addEventListener("click", () => { setComposerMode("create"); els.composer.showModal(); });
  $("#closeComposer").addEventListener("click", () => els.composer.close());
  $("#urlInput").addEventListener("input", (e) => $("#typeInput").value = detectType(e.target.value));
  $("#analyzeLinkButton").addEventListener("click", analyzeLink);
  $("#findPlaceButton").addEventListener("click", () => fillPlaceFromText($("#addressInput").value, $("#titleInput").value, $("#summaryInput").value));
  $("#geocodeButton").addEventListener("click", geocodeAddress);
  $("#extractCandidatesButton").addEventListener("click", () => { const candidates = candidatesFromText($("#summaryInput").value); renderCandidates(candidates); setStatus(candidates.length ? `${candidates.length}개 후보를 찾았습니다.` : "요약에서 주소 후보를 찾지 못했습니다."); });
  $("#saveCandidatesButton").addEventListener("click", saveSelectedCandidates);
  $("#deleteSpotButton").addEventListener("click", deleteActiveSpot);
  $("#editSpotButton").addEventListener("click", () => { const spot = spots.find((item) => item.id === activeSpotId); if (!spot) return setStatus("수정할 항목이 없습니다."); setComposerMode("edit", spot); els.composer.showModal(); });
  els.locateButton.addEventListener("click", moveToCurrentLocation);
  els.installButton.addEventListener("click", async () => { if (!installPromptEvent) return setStatus("브라우저 메뉴에서 홈 화면에 추가를 사용하세요."); installPromptEvent.prompt(); installPromptEvent = null; els.installButton.hidden = true; });
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPromptEvent = event; els.installButton.hidden = false; });
  document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => { const bar = $(".filterbar"); if (button.dataset.filter === "all" && bar.classList.contains("collapsed")) { bar.classList.remove("collapsed"); return; } document.querySelectorAll(".filter").forEach((item) => item.classList.remove("active")); button.classList.add("active"); activeFilter = button.dataset.filter; activeSpotId = filteredSpots()[0]?.id || null; renderPins(); bar.classList.add("collapsed"); }));
  els.fallbackPins.addEventListener("click", (e) => { const pin = e.target.closest(".fallback-pin"); if (pin) selectSpot(pin.dataset.id); });
  document.addEventListener("click", (e) => { const marker = e.target.closest(".kakao-category-marker"); if (marker) selectSpot(marker.dataset.markerId); });
  els.relatedList.addEventListener("click", (e) => { const item = e.target.closest("[data-related-id]"); if (item) selectSpot(item.dataset.relatedId); });
  els.form.addEventListener("submit", async (e) => { e.preventDefault(); const data = new FormData(els.form); const lat = Number(data.get("lat")); const lng = Number(data.get("lng")); const hasCoords = Number.isFinite(lat) && Number.isFinite(lng); const spot = { id: editingSpotId || crypto.randomUUID(), url: data.get("url").trim(), title: data.get("title").trim(), type: data.get("type"), category: data.get("category"), address: data.get("address").trim(), lat: hasCoords ? lat : 37.5665, lng: hasCoords ? lng : 126.9780, summary: data.get("summary").trim(), createdAt: new Date().toISOString().slice(0, 10) }; try { const saved = editingSpotId ? await updateSpot(spot) : await saveSpot(spot); activeSpotId = saved.id; editingSpotId = null; els.form.reset(); els.composer.close(); renderPins(); setStatus("DB에 저장됐습니다."); } catch (error) { console.warn(error); setStatus("저장 실패: Supabase 정책 또는 연결을 확인해 주세요."); } });
}

async function init() {
  try {
    spots = hasDb() ? await loadRemoteSpots() : JSON.parse(localStorage.getItem("sns-map-spots") || "null") || sampleSpots();
    if (!spots.length) spots = sampleSpots();
  } catch (error) {
    console.warn(error);
    spots = JSON.parse(localStorage.getItem("sns-map-spots") || "null") || sampleSpots();
  }
  bindEvents();
  await initMap();
  const params = new URLSearchParams(location.search);
  const sharedUrl = params.get("share_url") || params.get("url") || params.get("text");
  if (sharedUrl) { setComposerMode("create"); $("#urlInput").value = sharedUrl; $("#typeInput").value = detectType(sharedUrl); els.composer.showModal(); }
}

init();
