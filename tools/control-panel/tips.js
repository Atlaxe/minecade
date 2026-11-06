// Tooltips for the Panel and the map viewer: an element with data-tip (what it does) and data-key
// (its key, such as "Ctrl+Z") shows them after the pointer rests on it for a second. One listener
// for the whole page, so elements drawn later get tooltips too.
(() => {
  const DELAY = 1000;
  let timer = 0;
  let shown = null;
  /** The element waiting out the delay. */
  let pending = null;
  let tip = null;

  const hide = () => {
    clearTimeout(timer);
    shown = null;
    pending = null;
    if (tip) tip.hidden = true;
  };

  const show = (target) => {
    if (!target.isConnected) return;
    tip ??= Object.assign(document.createElement("div"), { className: "tip", role: "tooltip" });
    if (!tip.isConnected) document.body.append(tip);
    tip.replaceChildren(target.dataset.tip ?? "");
    if (target.dataset.key) {
      const key = document.createElement("kbd");
      key.textContent = target.dataset.key;
      tip.append(key);
    }
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    const size = tip.getBoundingClientRect();
    const left = Math.min(innerWidth - size.width - 8, Math.max(8, box.left + box.width / 2 - size.width / 2));
    const below = box.bottom + 8 + size.height < innerHeight;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? box.bottom + 8 : box.top - size.height - 8}px`;
    shown = target;
  };

  document.addEventListener("mouseover", (event) => {
    const target = event.target instanceof Element ? event.target.closest("[data-tip]") : null;
    if (target && target === (shown ?? pending)) return;
    hide();
    if (!target) return;
    pending = target;
    timer = setTimeout(() => show(target), DELAY);
  });
  document.addEventListener("mouseout", (event) => {
    const into = event.relatedTarget instanceof Element ? event.relatedTarget.closest("[data-tip]") : null;
    if (!into) hide();
  });
  document.addEventListener("mousedown", hide, true);
  document.addEventListener("keydown", hide, true);
  addEventListener("blur", hide);
})();
