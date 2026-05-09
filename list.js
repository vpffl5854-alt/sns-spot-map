(function () {
  const panel = document.querySelector("#spotListPanel");
  const openButton = document.querySelector("#openListButton");
  const closeButton = document.querySelector("#closeListButton");
  const searchInput = document.querySelector("#spotSearchInput");
  const meta = document.querySelector("#spotListMeta");
  const list = document.querySelector("#spotList");
  let currentPosition = null;
  let query = "";

  if (!panel || !openButton || !closeButton || !searchInput || !meta || !list) return;

  const categoryNames = {
    korean: "한식",
    chinese: "중식",
    japanese: "일식",
    western: "양식",
    cafe: "카페",
    bakery: "빵",
    bar: "술집",
    other: "미분류"
  };
  const categoryIcons = {
    korean: "한",
    chinese: "중",
    japanese: "일",
    western: "양",
    cafe: "카",
    bakery: "빵",
    bar: "술",
    other: "기"
  };
  const typeNames = {
    instagram: "Instagram",
    blog: "Naver Blog",
    cafe: "Naver Cafe",
    other: "기타"
  };

  function splitCategories(value) {
    return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
  }

  function primaryCategory(spot) {
    const categories = splitCategories(spot.category);
    return categories.find((category) => categoryNames[category]) || (categories[0] ? "custom" : "other");
  }

  function categoryText(value) {
    const categories = splitCategories(value);
    return categories.length ? categories.map((category) => categoryNames[category] || category).join(", ") : "미분류";
  }

  function categoryIcon(value) {
    const first = splitCategories(value)[0];
    return first ? (categoryIcons[first] || first.slice(0, 1)) : "?";
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function distanceKm(spot) {
    if (!currentPosition || !Number.isFinite(Number(spot.lat)) || !Number.isFinite(Number(spot.lng))) return null;
    const toRad = (degree) => degree * Math.PI / 180;
    const earthRadiusKm = 6371;
    const lat1 = toRad(currentPosition.lat);
    const lat2 = toRad(Number(spot.lat));
    const deltaLat = toRad(Number(spot.lat) - currentPosition.lat);
    const deltaLng = toRad(Number(spot.lng) - currentPosition.lng);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(km) {
    if (km === null) return "거리 미확인";
    if (km < 1) return `${Math.round(km * 1000)}m`;
    if (km < 10) return `${km.toFixed(1)}km`;
    return `${Math.round(km)}km`;
  }

  function searchText(spot) {
    return [
      spot.title,
      spot.address,
      categoryText(spot.category),
      typeNames[spot.type],
      spot.summary
    ].filter(Boolean).join(" ").toLowerCase();
  }

  function getRows() {
    const savedSpots = Array.isArray(spots) ? spots : [];
    const normalizedQuery = query.trim().toLowerCase();
    return savedSpots
      .filter((spot) => !normalizedQuery || searchText(spot).includes(normalizedQuery))
      .map((spot) => ({ spot, distance: distanceKm(spot) }))
      .sort((a, b) => {
        if (a.distance !== null && b.distance !== null) return a.distance - b.distance;
        if (a.distance !== null) return -1;
        if (b.distance !== null) return 1;
        return String(a.spot.title || "").localeCompare(String(b.spot.title || ""), "ko");
      });
  }

  function render() {
    if (panel.hidden) return;
    const rows = getRows();
    meta.textContent = currentPosition
      ? `${rows.length}개 표시 · 현재 위치 기준`
      : `${rows.length}개 표시 · 현재 위치 허용 시 거리순`;
    list.innerHTML = rows.length
      ? rows.map(({ spot, distance }) => `
        <button class="spot-list-item ${spot.id === activeSpotId ? "active" : ""}" type="button" data-list-spot-id="${escapeHtml(spot.id)}">
          <span class="spot-list-icon cat-${primaryCategory(spot)}">${escapeHtml(categoryIcon(spot.category))}</span>
          <span class="spot-list-copy">
            <strong>${escapeHtml(spot.title)}</strong>
            <small>${escapeHtml(categoryText(spot.category))} · ${escapeHtml(spot.address)}</small>
          </span>
          <span class="spot-list-distance">${formatDistance(distance)}</span>
        </button>
      `).join("")
      : "<p class=\"empty-state\">검색 결과가 없습니다.</p>";
  }

  function refreshPosition() {
    if (!navigator.geolocation || currentPosition) {
      render();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        currentPosition = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        render();
      },
      render,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
    );
  }

  openButton.addEventListener("click", () => {
    panel.hidden = false;
    render();
    refreshPosition();
    searchInput.focus();
  });

  closeButton.addEventListener("click", () => {
    panel.hidden = true;
  });

  searchInput.addEventListener("input", (event) => {
    query = event.target.value;
    render();
  });

  list.addEventListener("click", (event) => {
    const item = event.target.closest("[data-list-spot-id]");
    if (!item) return;

    selectSpot(item.dataset.listSpotId);
    const spot = spots.find((entry) => entry.id === item.dataset.listSpotId);
    if (spot && map && window.kakao) {
      map.setCenter(new kakao.maps.LatLng(spot.lat, spot.lng));
      map.setLevel(4);
    }
    render();
  });

  document.querySelector("#locateButton")?.addEventListener("click", () => {
    currentPosition = null;
    setTimeout(refreshPosition, 300);
  });
})();
