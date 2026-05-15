(function () {
  const focusLevel = 3;

  function clickedSpotId(event) {
    const item = event.target.closest("[data-list-spot-id], [data-marker-id], [data-id], [data-related-id]");
    if (!item) return "";

    return item.dataset.listSpotId || item.dataset.markerId || item.dataset.relatedId || item.dataset.id || "";
  }

  function focusSpot(spotId) {
    if (!spotId || typeof map === "undefined" || !map || !window.kakao || typeof spots === "undefined") return;

    const spot = spots.find((entry) => entry.id === spotId);
    if (!spot || !Number.isFinite(Number(spot.lat)) || !Number.isFinite(Number(spot.lng))) return;

    const position = new kakao.maps.LatLng(Number(spot.lat), Number(spot.lng));
    const currentLevel = typeof map.getLevel === "function" ? map.getLevel() : focusLevel;
    map.setLevel(Math.min(currentLevel, focusLevel));
    map.panTo(position);
  }

  window.focusSpotOnMap = focusSpot;

  document.addEventListener("click", (event) => {
    const spotId = clickedSpotId(event);
    if (!spotId) return;

    window.setTimeout(() => focusSpot(spotId), 0);
  });
})();
