(() => {
  const DROP_COOLDOWN_SEC = 3600;
  const DROP_MIN_OPEN_MS = 1200;
  const RARITIES = [
    { key: "", title: "Все" },
    { key: "common", title: "N · Common" },
    { key: "rare", title: "R · Rare" },
    { key: "epic", title: "SR · Epic" },
    { key: "legendary", title: "SSR · Legendary" },
    { key: "mythical", title: "UR · Mythical" },
  ];
  const SORTS = [
    { key: "new", title: "Новые" },
    { key: "old", title: "Старые" },
    { key: "rarity", title: "Редкость" },
  ];
  const COLLECTION_FILTERS = [
    { key: "", title: "Все карты" },
    { key: "recent", title: "За 7 дней" },
    { key: "favorites", title: "Избранное" },
  ];
  const tg = window.Telegram?.WebApp;
  const appVersion = new URLSearchParams(location.search).get("v");
  const getInitData = () => window.Telegram?.WebApp?.initData || "";

  // Запрещаем масштабирование (pinch/double-tap) и перетаскивание картинок.
  const blockGesture = (event) => event.preventDefault();
  ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
    document.addEventListener(type, blockGesture, { passive: false });
  });
  document.addEventListener("touchmove", (event) => {
    if (event.touches.length > 1) event.preventDefault();
  }, { passive: false });
  document.addEventListener("dragstart", (event) => {
    if (event.target instanceof Element && event.target.closest("img")) {
      event.preventDefault();
    }
  });
  document.addEventListener("dblclick", blockGesture, { passive: false });
  const configuredApiBase = document.querySelector('meta[name="mini-app-api"]')
    ?.content.trim() || "";
  const apiBase = configuredApiBase.startsWith("__")
    ? "" : configuredApiBase.replace(/\/+$/, "");
  const MAX_IMAGE_URLS = 80;
  const MAX_IMAGE_FETCHES = 6;
  let activeImageFetches = 0;
  const imageFetchWaiters = [];
  const state = {
    tradeToken: new URLSearchParams(location.search).get("trade"),
    trade: null, inventory: [], page: 1, pages: 1, balance: 0,
    crystals: 0, rolls: 0, rollCrystalCost: 10,
    maxRollPurchaseBatch: 100, ticketPurchaseInProgress: false,
    selected: new Map(), collectionSelected: new Map(),
    query: "", link: "", imageUrls: new Map(), imagePromises: new Map(),
    collectionPage: 1, collectionPages: 1, collectionQuery: "",
    collectionRarity: "", collectionSort: "new", collectionFilter: "", profile: null,
    collectionMode: "cards", collectionVersion: 0, receivedCards: [],
    marketItems: [], activePage: "home", transferLink: "",
    homeCards: [], collectionTotal: 0, ownedCardCount: 0,
    favorites: [], favoriteLimit: 3, shopFrames: [], framePacks: [], packOpening: false,
    frameShopCards: [], frameShopPage: 1, frameShopPages: 1,
    frameShopCardId: null, frameShopFrameId: null, framePreviewVersion: 0,
    frameShopPinnedCard: null, frameShopCardsVersion: 0,
    tradeSubmitting: false, transferSubmitting: false, listingSubmitting: false,
    caseCatalog: null, caseOpening: false,
    economyBusy: false, craftVersion: 0, craftAfter: null,
    referralLink: "",
    collectionItems: [], collectionLoading: false, selectMode: false,
    marketTab: "all", shopTab: "rolls", lastDropCard: null,
    dropStartedAt: 0, dropStageTimer: 0, dropTimer: 0, dropReadyAt: 0, dropBusy: false,
    mainClick: null, overlayOpen: false,
    publicPlayer: null, publicInventoryPage: 0,
    publicInventoryLoading: false, publicInventoryIds: new Set(),
    availableBackgrounds: [],
    backgroundCatalogRequest: null, backgroundSaving: false, backgroundSaveVersion: 0,
  };
  const el = (id) => document.getElementById(id);
  const albums = { series: null, page: 1, listPage: 1, version: 0 };
  const copies = { page: 1, version: 0, selected: new Map(), maxBatch: 0, busy: false };
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const staticBase = new URL(/\/app\/?$/.test(location.pathname) ? "/app/static/" : "./", location.href);
  // The API returns server-relative paths, but frame assets ship with the frontend.
  const frameAssetUrl = (path) => new URL(path.replace(/^\/app\/static\//, ""), staticBase).href;
  document.querySelectorAll("img[data-static-src]").forEach((image) => {
    let retries = 0;
    let usedFallback = false;
    if (image.id === "drop-card-cover") {
      image.addEventListener("load", () => image.parentElement.classList.add("has-cover"));
      image.addEventListener("error", () => image.parentElement.classList.remove("has-cover"));
    }
    image.addEventListener("error", async () => {
      if (retries >= 2) {
        if (image.dataset.staticFallback && !usedFallback) {
          usedFallback = true;
          image.src = new URL(image.dataset.staticFallback, staticBase).href;
        }
        return;
      }
      retries += 1;
      await pause(retries * 1000);
      const url = new URL(image.dataset.staticSrc, staticBase);
      url.searchParams.set("retry", String(retries));
      image.src = url.href;
    });
    image.src = new URL(image.dataset.staticSrc, staticBase).href;
  });
  function formatCardCount(count) {
    const lastTwo = count % 100;
    const last = count % 10;
    const noun = lastTwo >= 11 && lastTwo <= 14 ? "карт"
      : last === 1 ? "карта" : last >= 2 && last <= 4 ? "карты" : "карт";
    return `${count} ${noun}`;
  }
  const selectedCards = () => [...state.selected.values()];
  const hasCustomFrame = (card) => Boolean(card.frame_style && card.frame_style !== "classic");
  const frameHandoffWarning = (cards) => {
    const framed = cards.filter(hasCustomFrame);
    return framed.length
      ? `Особых рамок на картах: ${framed.length}. Они перейдут новым владельцам вместе с картами.`
      : "Любая надетая особая рамка переходит новому владельцу вместе с картой.";
  };
  const rarityClass = (rarity) => `rarity-${rarity}`;

  try {
    tg?.ready();
    tg?.expand();
    tg?.setHeaderColor?.("#0f0c1a");
    tg?.setBackgroundColor?.("#0f0c1a");
  } catch (_error) { /* browser preview */ }

  function haptic(kind) {
    try {
      const feedback = tg?.HapticFeedback;
      if (!feedback) return;
      if (kind === "success" || kind === "error" || kind === "warning") {
        feedback.notificationOccurred(kind);
      } else {
        feedback.impactOccurred(kind || "light");
      }
    } catch (_error) { /* missing Telegram runtime */ }
  }

  async function api(path, options = {}) {
    const initData = getInitData();
    const method = (options.method || "GET").toUpperCase();
    const idempotencyKey = method === "POST"
      ? (options.idempotencyKey || (crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}_${Math.random().toString(36).slice(2)}`)) : null;
    const requestOptions = {
      ...options,
      headers: {
        Authorization: `tma ${initData}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...options.headers,
      },
    };
    let response;
    const attempts = method === "GET" ? 3 : method === "POST" ? 2 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = method === "GET" ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;
      try {
        response = await fetch(`${apiBase}${path}`, {
          ...requestOptions,
          ...(controller ? { signal: controller.signal } : {}),
        });
      } catch (error) {
        if (attempt === attempts - 1) throw error;
        if (method === "GET") await pause((attempt + 1) * 500);
        continue;
      } finally {
        clearTimeout(timeout);
      }
      if (method !== "GET" || ![502, 503, 504].includes(response.status) || attempt === attempts - 1) break;
      await response.body?.cancel();
      await pause((attempt + 1) * 500);
    }
    const data = response.headers.get("content-type")?.includes("application/json")
      ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || `Ошибка сервера (${response.status})`);
    return data;
  }

  function showToast(text, isError = false) {
    const toast = el("toast");
    toast.textContent = text;
    toast.classList.toggle("error", isError);
    toast.classList.add("show");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
  }
  function showError(error) {
    showToast(error?.message || "Не удалось выполнить запрос.", true);
  }
  function showNotice(text) { showToast(text); }

  function openInfoPopup(title, text) {
    const popup = el("info-popup");
    el("info-popup-title").textContent = title;
    el("info-popup-text").textContent = text;
    popup.hidden = false;
    state.overlayOpen = true;
    syncBackButton();
    el("info-popup-title").focus();
  }

  function closeInfoPopup() {
    const popup = el("info-popup");
    popup.hidden = true;
    state.overlayOpen = false;
    syncBackButton();
  }

  function confirmAction(text) {
    if (getInitData() && tg?.showConfirm) {
      return new Promise((resolve) => {
        try { tg.showConfirm(text, resolve); }
        catch { resolve(window.confirm(text)); }
      });
    }
    return Promise.resolve(window.confirm(text));
  }

  let shopDialogResolve = null;
  let shopDialogPreviousFocus = null;

  function closeShopDialog(confirmed = false) {
    if (!shopDialogResolve) return;
    const resolve = shopDialogResolve;
    shopDialogResolve = null;
    el("shop-dialog").hidden = true;
    syncBackButton();
    const previousFocus = shopDialogPreviousFocus;
    shopDialogPreviousFocus = null;
    resolve(confirmed);
    requestAnimationFrame(() => {
      if (el("shop-dialog").hidden && previousFocus?.isConnected && !previousFocus.disabled) {
        previousFocus.focus();
      }
    });
  }

  function showShopDialog({ title, item, description, art, price, currency, success = false }) {
    if (shopDialogResolve) return Promise.resolve(false);
    const dialog = el("shop-dialog");
    shopDialogPreviousFocus = document.activeElement;
    el("shop-dialog-title").textContent = title;
    el("shop-dialog-item").textContent = item;
    el("shop-dialog-description").textContent = description;
    const artwork = el("shop-dialog-art");
    artwork.className = `shop-dialog-art shop-dialog-art--${art}`;
    artwork.replaceChildren();
    const priceRow = el("shop-dialog-price");
    priceRow.hidden = success;
    if (!success) {
      el("shop-dialog-currency").className = `currency-icon chip-${currency}`;
      el("shop-dialog-amount").textContent = String(price);
      el("shop-dialog-currency-label").textContent = currency === "dust" ? "пыли" : "кристаллов";
    }
    el("shop-dialog-confirm").textContent = success ? "Отлично" : "Подтвердить";
    el("shop-dialog-cancel").hidden = success;
    dialog.classList.toggle("is-success", success);
    dialog.hidden = false;
    syncBackButton();
    el("shop-dialog-confirm").focus();
    return new Promise((resolve) => { shopDialogResolve = resolve; });
  }

  function setMainButton(text, onClick) {
    clearMainButton();
    if (!tg?.MainButton) return false;
    state.mainClick = onClick;
    tg.MainButton.setText(text);
    tg.MainButton.onClick(onClick);
    tg.MainButton.show();
    return true;
  }
  function clearMainButton() {
    if (!tg?.MainButton) return;
    if (state.mainClick) {
      try { tg.MainButton.offClick(state.mainClick); } catch (_error) { /* old clients */ }
      state.mainClick = null;
    }
    try { tg.MainButton.hide(); } catch (_error) { /* old clients */ }
  }

  function syncBackButton() {
    const open = !el("sheet").hidden || !el("drop-overlay").hidden ||
      !el("case-overlay").hidden || !el("frame-roulette").hidden || !el("info-popup").hidden || !el("shop-dialog").hidden ||
      el("vip-history-dialog").open || state.activePage === "player" || state.activePage === "showcases";
    if (!tg?.BackButton) return;
    try {
      if (open) tg.BackButton.show();
      else tg.BackButton.hide();
    } catch (_error) { /* old clients */ }
  }

  function showPage(name, { loadShop = true } = {}) {
    haptic("light");
    state.activePage = name;
    syncAppBackground();
    document.querySelectorAll(".page-view").forEach((page) => {
      page.hidden = page.id !== `${name}-page`;
    });
    document.querySelectorAll(".main-nav button").forEach((button) => {
      button.classList.toggle("active", button.dataset.page === name);
    });
    if (name === "collection") refreshCollection();
    renderCollectionSelection();
    if (name === "account") loadAccount().catch(showError);
    if (name === "crystals" && state.shopTab === "frames" && loadShop) {
      loadFrameShop().catch(showError);
    }
    if (name === "crystals" && state.shopTab === "cases") {
      loadCaseCatalog().catch(showError);
    }
    if (name === "trade") {
      setMarketTab(state.tradeToken ? "trade" : state.marketTab, true);
    }
    syncBackButton();
  }

  function setBalance(balance) {
    state.balance = balance;
    el("balance").textContent = String(balance);
    if (state.shopFrames.length) renderFrameShop();
    renderEconomyStatus();
  }
  function setProfileAvatar(id, profile) {
    const avatar = el(id);
    if (!avatar) return;
    avatar.replaceChildren();
    if (profile.photo_url) {
      const image = document.createElement("img");
      image.src = profile.photo_url;
      image.alt = `${profile.display_name}: аватар`;
      image.addEventListener("error", () => { avatar.textContent = ""; }, { once: true });
      avatar.append(image);
    } else {
      avatar.append(icon("profile"));
    }
    avatar.setAttribute("aria-label", `Аватар: ${profile.display_name}`);
  }
  function setCrystals(balance) {
    state.crystals = balance;
    el("crystals-balance").textContent = balance;
    updateRollShopButtons();
    updateCaseButton();
  }
  function setRolls(balance) {
    state.rolls = balance;
    el("roll-balance").textContent = balance;
    el("extra-roll-count").textContent = balance;
    el("home-ticket-panel").hidden = balance < 1;
    el("home-ticket-count").textContent = `${balance} ${ticketWord(balance)}`;
    updateDropButton();
  }
  function ticketWord(amount) {
    const remainder100 = amount % 100;
    const remainder10 = amount % 10;
    if (remainder100 >= 11 && remainder100 <= 14) return "билетов";
    if (remainder10 === 1) return "билет";
    if (remainder10 >= 2 && remainder10 <= 4) return "билета";
    return "билетов";
  }
  function updateRollShopButtons() {
    const slider = el("ticket-amount");
    const button = el("buy-tickets-button");
    if (!slider || !button) return;
    const sliderMax = Math.max(1, state.maxRollPurchaseBatch);
    slider.max = String(sliderMax);
    const amount = Math.max(1, Math.min(Number(slider.value) || 1, sliderMax));
    slider.value = String(amount);
    button.dataset.buyRolls = String(amount);
    el("ticket-amount-label").textContent = `${amount} ${ticketWord(amount)}`;
    el("ticket-cost").textContent = String(amount * state.rollCrystalCost);
    slider.disabled = state.ticketPurchaseInProgress;
    button.disabled = state.ticketPurchaseInProgress;
    el("ticket-shop-hint").textContent =
      `Можно выбрать до ${sliderMax} ${ticketWord(sliderMax)}.`;
  }

  function formatDuration(seconds) {
    const value = Math.max(0, seconds);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = value % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon-sm");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function frameEffects(effect, cardRarity = "epic", frameRarity = "epic", accent, ornamentUrl, theme) {
    if (!["pulse", "petals", "shimmer", "radiance", "moon_garden", "neon", "ice_prism",
      "imperial", "phoenix", "ocean", "astral", "forest", "gothic"].includes(effect)) return null;
    const fx = document.createElement("span");
    const premium = frameRarity === "legendary" || frameRarity === "mythical";
    fx.className = `frame-live-fx frame-live-fx--${effect} frame-live-fx--tier-${premium ? "ssr" : frameRarity === "epic" ? "sr" : "r"}`;
    fx.dataset.theme = theme || "";
    if (accent) fx.style.setProperty("--fx-color", accent);
    fx.setAttribute("aria-hidden", "true");
    if (cardRarity === "legendary" || cardRarity === "mythical") {
      fx.style.inset = "2.83% 4.13%";
    }
    if (premium && ornamentUrl) {
      for (let corner = 0; corner < 4; corner += 1) {
        const mount = document.createElement("span");
        mount.className = "frame-fx-corner";
        const image = document.createElement("img");
        image.src = frameAssetUrl(ornamentUrl.replace(".webp", `_${corner}.webp`));
        image.style.setProperty("--ornament-origin", ["25% 25%", "75% 25%", "25% 75%", "75% 75%"][corner]);
        image.alt = "";
        mount.append(image);
        fx.append(mount);
      }
    }
    return fx;
  }

  document.addEventListener("visibilitychange", () => {
    document.documentElement.classList.toggle("page-hidden", document.hidden);
  });

  function cardEffects(rarity) {
    if (rarity !== "legendary" && rarity !== "mythical") return null;
    const fx = document.createElement("span");
    fx.className = "card-fx";
    fx.setAttribute("aria-hidden", "true");

    const aura = document.createElement("span");
    aura.className = "card-fx-aura";
    fx.append(aura);

    if (rarity === "mythical") {
      const holo = document.createElement("span");
      holo.className = "card-fx-holo";
      fx.append(holo);
    }

    const sheen = document.createElement("span");
    sheen.className = "card-fx-sheen";
    fx.append(sheen);

    const sparks = document.createElement("span");
    sparks.className = "card-fx-sparks";
    const sparkCount = rarity === "mythical" ? 6 : 5;
    for (let index = 0; index < sparkCount; index += 1) {
      const spark = document.createElement("span");
      spark.style.setProperty("--spark-i", String(index));
      sparks.append(spark);
    }
    fx.append(sparks);

    if (rarity === "mythical") {
      const orbit = document.createElement("span");
      orbit.className = "card-fx-orbit";
      for (let index = 0; index < 3; index += 1) {
        const spark = document.createElement("span");
        spark.style.setProperty("--spark-i", String(index));
        orbit.append(spark);
      }
      fx.append(orbit);
    }

    return fx;
  }

  async function withImageFetchSlot(callback) {
    if (activeImageFetches >= MAX_IMAGE_FETCHES) {
      await new Promise((resolve) => imageFetchWaiters.push(resolve));
    }
    activeImageFetches += 1;
    try {
      return await callback();
    } finally {
      activeImageFetches -= 1;
      imageFetchWaiters.shift()?.();
    }
  }

  function rememberImageUrl(cacheKey, url) {
    while (state.imageUrls.size >= MAX_IMAGE_URLS) {
      const oldestKey = state.imageUrls.keys().next().value;
      URL.revokeObjectURL(state.imageUrls.get(oldestKey));
      state.imageUrls.delete(oldestKey);
    }
    state.imageUrls.set(cacheKey, url);
  }

  function loadCardImageUrl(card, tradeToken = "", frameStyle = card.frame_style) {
    const cacheKey = `${card.id}:${frameStyle || "legacy"}:${card.upgrade_level || 0}:${tradeToken || ""}`;
    const cachedUrl = state.imageUrls.get(cacheKey);
    if (cachedUrl) return Promise.resolve(cachedUrl);
    let imagePromise = state.imagePromises.get(cacheKey);
    if (imagePromise) return imagePromise;
    const imageQuery = new URLSearchParams();
    imageQuery.set("live_frame", "1");
    imageQuery.set("upgrade", card.upgrade_level || 0);
    if (appVersion) imageQuery.set("v", appVersion);
    if (tradeToken) imageQuery.set("trade", tradeToken);
    if (frameStyle) imageQuery.set("frame", frameStyle);
    const queryString = imageQuery.toString();
    imagePromise = withImageFetchSlot(async () => {
      const response = await fetch(
        `${apiBase}${card.image_url}${queryString ? `?${queryString}` : ""}`,
        { headers: { Authorization: `tma ${getInitData()}` } },
      );
      if (!response.ok) throw new Error("Изображение недоступно");
      const url = URL.createObjectURL(await response.blob());
      rememberImageUrl(cacheKey, url);
      return url;
    }).finally(() => state.imagePromises.delete(cacheKey));
    state.imagePromises.set(cacheKey, imagePromise);
    return imagePromise;
  }

  function cardButton(card, selected, disabled, onClick, tradeToken = state.tradeToken, previousImageUrl) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `card ${selected ? "selected" : ""} ${disabled && card.lock_reason ? "locked" : ""} ${rarityClass(card.rarity)}`;
    const favorite = state.favorites.some((item) => item.id === card.id);
    const lockLabels = { listing: "на аукционе", trade: "в обмене", transfer: "в передаче" };
    button.setAttribute("aria-label", [card.name, card.rarity_title,
      favorite ? "в избранном" : "", card.lock_reason ? (lockLabels[card.lock_reason] || "заблокирована") : ""]
      .filter(Boolean).join(", "));
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    image.src = previousImageUrl || "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 3'%3E%3Crect width='2' height='3' fill='%23181427'/%3E%3C/svg%3E";
    button.append(image);
    if (card.rarity === "mythical") {
      const tint = document.createElement("span");
      tint.className = "card-tint";
      tint.setAttribute("aria-hidden", "true");
      button.append(tint);
    }
    const effects = cardEffects(card.rarity);
    if (effects) button.append(effects);
    const frameFx = frameEffects(card.frame_effect, card.rarity, card.frame_rarity,
      card.frame_accent, card.frame_ornament_url, card.frame_theme);
    if (frameFx) button.append(frameFx);
    if (card.upgrade_level > 0) {
      const artFx = document.createElement("span");
      artFx.className = "card-art-fx";
      artFx.dataset.level = card.upgrade_level;
      if (hasCustomFrame(card) || card.rarity === "legendary" || card.rarity === "mythical") {
        artFx.classList.add("card-art-fx--padded");
      }
      artFx.setAttribute("aria-hidden", "true");
      button.append(artFx);
    }
    const marks = document.createElement("span");
    marks.className = "card-marks";
    if (card.lock_reason) {
      const lock = document.createElement("span");
      lock.className = "mark-pill";
      lock.append(icon("lock"));
      marks.append(lock);
    }
    if (state.favorites.some((favorite) => favorite.id === card.id)) {
      const star = document.createElement("span");
      star.className = "mark-pill";
      star.append(icon("star"));
      marks.append(star);
    }
    if (selected) {
      const check = document.createElement("span");
      check.className = "mark-pill";
      check.append(icon("check"));
      marks.append(check);
    }
    if (marks.childElementCount) button.append(marks);
    if (onClick) {
      let pressTimer = 0;
      let pointerStart = null;
      button.addEventListener("click", (event) => {
        if (button.dataset.longPress === "1") {
          button.dataset.longPress = "0";
          event.preventDefault();
          return;
        }
        onClick(event);
      });
      button.addEventListener("pointerdown", (event) => {
        pointerStart = { x: event.clientX, y: event.clientY };
        pressTimer = window.setTimeout(() => {
          button.dataset.longPress = "1";
          onClick({ longPress: true, card });
        }, 480);
      });
      button.addEventListener("pointermove", (event) => {
        if (!pointerStart) return;
        if (Math.hypot(event.clientX - pointerStart.x,
          event.clientY - pointerStart.y) > 6) {
          window.clearTimeout(pressTimer);
          pointerStart = null;
        }
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((type) => {
        button.addEventListener(type, () => {
          window.clearTimeout(pressTimer);
          pointerStart = null;
        });
      });
    }
    let activePointer = null;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const setCardTilt = (event) => {
      if (reducedMotion.matches) return;
      const bounds = button.getBoundingClientRect();
      const x = Math.max(0, Math.min(1,
        (event.clientX - bounds.left) / bounds.width));
      const y = Math.max(0, Math.min(1,
        (event.clientY - bounds.top) / bounds.height));
      button.style.setProperty("--card-tilt-x", `${(0.5 - y) * 16}deg`);
      button.style.setProperty("--card-tilt-y", `${(x - 0.5) * 16}deg`);
    };
    button.addEventListener("pointerenter", (event) => {
      if (event.pointerType === "mouse") setCardTilt(event);
    });
    button.addEventListener("pointerdown", (event) => {
      if (reducedMotion.matches || event.button !== 0) return;
      activePointer = event.pointerId;
      button.classList.add("is-tilting");
      button.setPointerCapture(event.pointerId);
      setCardTilt(event);
    });
    button.addEventListener("pointermove", (event) => {
      if (activePointer === event.pointerId) setCardTilt(event);
      else if (event.pointerType === "mouse" && event.buttons === 0) setCardTilt(event);
    });
    const resetTilt = (event) => {
      if (activePointer !== event.pointerId) return;
      activePointer = null;
      button.classList.remove("is-tilting");
      button.style.removeProperty("--card-tilt-x");
      button.style.removeProperty("--card-tilt-y");
    };
    button.addEventListener("pointerup", resetTilt);
    button.addEventListener("pointercancel", resetTilt);
    button.addEventListener("lostpointercapture", resetTilt);
    button.addEventListener("pointerleave", (event) => {
      if (activePointer === null) {
        button.style.removeProperty("--card-tilt-x");
        button.style.removeProperty("--card-tilt-y");
      } else if (event.pointerType === "mouse") {
        resetTilt(event);
      }
    });
    loadCardImageUrl(card, tradeToken).then((url) => {
      image.src = url;
    }).catch(showError);
    return button;
  }

  function updateDropButton() {
    const stock = state.profile?.free_drops;
    const free = stock?.available ?? 0;
    const maximum = stock?.maximum ?? 5;
    el("free-drop-count").textContent = stock ? `${free} / ${maximum}` : `— / ${maximum}`;
    el("drop-slots").querySelectorAll("i").forEach((slot, index) => {
      slot.classList.toggle("filled", index < free);
    });
    el("drop-button").disabled = !stock || !free || state.dropBusy;
    el("drop-all-button").disabled = !stock || !free || state.dropBusy;
    el("drop-all-button").textContent = free > 0 ? `Открыть все · ${free}` : "Открыть все";
    el("ticket-drop-button").disabled = !state.profile || state.rolls < 1 || state.dropBusy;
  }

  function showDropLoadError(error) {
    el("drop-error").textContent = `Не удалось обновить запас: ${error.message}`;
    el("drop-error").hidden = false;
    el("drop-retry").hidden = false;
    if (!state.profile) el("drop-timer").textContent = "Запас недоступен";
    showError(error);
  }

  function updateDropTimer() {
    if (!state.profile) return;
    clearTimeout(state.dropTimer);
    const stock = state.profile.free_drops;
    const seconds = Math.max(0, Math.ceil((state.dropReadyAt - Date.now()) / 1000));
    if (!seconds && stock.next_in != null) {
      el("drop-timer").textContent = "Обновляем запас…";
      loadProfile().catch(showDropLoadError);
      return;
    }
    const timer = el("drop-timer");
    const ring = el("drop-ring");
    timer.textContent = stock.next_in == null ? "✦ Запас полон" : `Следующее открытие через ${formatDuration(seconds)}`;
    const cooldown = state.profile.drop_cooldown_duration || DROP_COOLDOWN_SEC;
    ring.style.setProperty("--progress", String(Math.max(0, Math.min(1, 1 - seconds / cooldown))));
    updateDropButton();
    if (seconds > 0) state.dropTimer = window.setTimeout(updateDropTimer, 1000);
  }

  function renderHome() {
    const container = el("home-showcase");
    container.replaceChildren();
    if (!state.homeCards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Откройте первую карту";
      container.append(empty);
      return;
    }
    state.homeCards.forEach((card) => {
      container.append(cardButton(card, false, false, () => {
        openCardSheet(card);
      }, ""));
    });
  }

  function updateProfileTier(profile) {
    const isVip = Boolean(profile.vip.active);
    el("account-page").classList.toggle("profile--vip", isVip);
    el("account-avatar").classList.toggle("vip-avatar", isVip);
    el("profile-tier-badge").hidden = !isVip;
  }

  async function fetchOwnProfile() {
    const backgroundSaveVersion = state.backgroundSaveVersion;
    const profile = await api("/api/me");
    if (backgroundSaveVersion !== state.backgroundSaveVersion) {
      profile.profile_background = state.profile.profile_background;
    }
    state.profile = profile;
    if (profile.profile_background) await loadBackgrounds();
    syncAppBackground();
    return profile;
  }

  async function loadProfile() {
    const profile = await fetchOwnProfile();
    el("drop-error").hidden = true;
    el("drop-retry").hidden = true;
    state.dropReadyAt = Date.now() + (profile.free_drops.next_in || 0) * 1000;
    state.favoriteLimit = profile.favorite_limit;
    state.rollCrystalCost = profile.roll_crystal_cost;
    state.maxRollPurchaseBatch = profile.max_roll_purchase_batch ?? 100;
    setBalance(profile.balance);
    setCrystals(profile.crystals);
    setRolls(profile.rolls);
    renderEconomyStatus();
    setProfileAvatar("home-avatar", profile);
    updateProfileTier(profile);
    state.ownedCardCount = profile.card_count;
    el("card-count").textContent = state.ownedCardCount;
    el("welcome").textContent = profile.display_name;
    el("daily-button").disabled = !profile.daily_reward_available;
    el("daily-button").textContent = profile.daily_reward_available ? "Забрать" : "Получено";
    el("daily-status").textContent = profile.daily_reward_available
      ? `Ежедневная награда: ${profile.vip_daily_reward} пыли${
        profile.vip.active ? " · VIP-бонус" : ""}`
      : "Награда уже получена. После полуночи по Москве.";
    updateDropTimer();
    const inventory = await api("/api/inventory?page=1");
    state.ownedCardCount = inventory.total;
    el("card-count").textContent = state.ownedCardCount;
    state.homeCards = inventory.items.slice(0, 10);
    renderHome();
    updateDropTimer();
  }

  function ensureDropParticles() {
    const container = el("drop-particles");
    if (!container || container.childElementCount) return;
    const count = 24;
    for (let index = 0; index < count; index += 1) {
      const particle = document.createElement("span");
      particle.style.setProperty(
        "--a", `${(360 / count) * index + (index % 2 ? 8 : -8)}deg`);
      particle.style.setProperty("--r", `${112 + (index % 5) * 22}px`);
      particle.style.setProperty("--delay", `${(index % 7) * 0.018}s`);
      particle.style.setProperty("--s", index % 3 === 0 ? "1.5" : "1");
      container.append(particle);
    }
  }

  let dropSession = null;
  function startDropOpening() {
    const overlay = el("drop-overlay");
    const session = { skipped: false, cancelled: false, wake: null };
    dropSession = session;
    overlay.hidden = false;
    overlay.className = "drop-overlay is-opening";
    state.dropStartedAt = performance.now();
    el("drop-close").hidden = true;
    el("drop-skip").hidden = false;
    el("drop-followup").hidden = true;
    el("drop-results").hidden = true;
    el("drop-results").replaceChildren();
    el("drop-title").textContent = "Призываем карту…";
    el("drop-rarity").textContent = "";
    el("drop-description").textContent = "Соединяемся со звёздами…";
    el("drop-revealed-card").replaceChildren();
    ensureDropParticles();
    el("drop-title").focus();
    state.dropStageTimer = setTimeout(() => {
      if (dropSession === session && !session.cancelled) {
        el("drop-description").textContent = "Ожидаем ответ сервера. Карты сохранятся в коллекции.";
      }
    }, 3000);
    syncBackButton();
  }
  function closeDropOpening() {
    if (dropSession) {
      dropSession.cancelled = true;
      dropSession.wake?.();
      dropSession = null;
    }
    clearTimeout(state.dropStageTimer);
    el("drop-overlay").hidden = true;
    el("drop-overlay").className = "drop-overlay";
    syncBackButton();
  }
  function dropWait(session, milliseconds) {
    if (session.skipped || session.cancelled) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(done, milliseconds);
      function done() { clearTimeout(timer); session.wake = null; resolve(); }
      session.wake = done;
    });
  }

  function prepareDropImage(card, image, session) {
    image.loading = "eager";
    return new Promise((resolve) => {
      const finish = (ready) => {
        clearTimeout(timer);
        if (session.wake === cancel) session.wake = null;
        resolve(ready);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, 8000);
      session.wake = cancel;
      loadCardImageUrl(card, "").then(async (url) => {
        image.src = url;
        await image.decode();
        finish(true);
      }).catch(() => finish(false));
    });
  }

  async function revealDrop(card, index, total, session) {
    const overlay = el("drop-overlay");
    const cardElement = cardButton(card, false, false, null, "");
    cardElement.setAttribute("aria-disabled", "true");
    el("drop-revealed-card").replaceChildren(cardElement);
    overlay.className = `drop-overlay is-preparing ${rarityClass(card.rarity)}`;
    el("drop-description").textContent = "Подготавливаем изображение карты…";
    const ready = await prepareDropImage(card, cardElement.querySelector("img"), session);
    if (session.skipped || session.cancelled) return;
    if (!ready) {
      showNotice("Карта сохранена. Изображение ещё загружается — его можно посмотреть в коллекции.");
      return;
    }
    el("drop-title").textContent = `Карта ${index + 1} из ${total}`;
    el("drop-rarity").textContent = card.rarity_title;
    el("drop-description").textContent = "Свет раскрывает новую встречу…";
    await dropWait(session, 900);
    if (session.skipped || session.cancelled) return;
    overlay.className = `drop-overlay is-revealing ${rarityClass(card.rarity)}`;
    haptic(card.rarity === "mythical" || card.rarity === "legendary" ? "heavy" : "medium");
    await dropWait(session, 1050);
    el("drop-description").textContent = card.name;
    if (session.skipped || session.cancelled) return;
    overlay.className = `drop-overlay is-revealed ${rarityClass(card.rarity)}`;
    await dropWait(session, 850);
  }

  function showDropResults(cards) {
    const overlay = el("drop-overlay");
    overlay.className = "drop-overlay is-results";
    const results = el("drop-results");
    results.replaceChildren(...cards.map((card) => {
      const item = document.createElement("div");
      item.className = "drop-result-item";
      const button = cardButton(card, false, false, () => openDropCollection(cards, card), "");
      const label = document.createElement("span");
      label.textContent = `${card.name} · ${card.rarity_title}`;
      item.append(button, label);
      return item;
    }));
    results.hidden = false;
    el("drop-title").textContent = cards.length === 1 ? "Карта получена!" : `Получено карт: ${cards.length}`;
    el("drop-rarity").textContent = "";
    el("drop-description").textContent = "Карты сохранены в коллекции.";
    el("drop-skip").hidden = true;
    el("drop-close").hidden = false;
    el("drop-followup").hidden = false;
    el("drop-dust").hidden = cards.length !== 1;
    el("drop-to-collection").onclick = () => openDropCollection(cards, cards.length === 1 ? cards[0] : null);
    if (cards.length === 1) el("drop-dust").textContent = `Распылить за ${cards[0].dust_value} пыли`;
    el("drop-close").focus();
    haptic("success");
  }

  function openDropCollection(cards, card) {
    closeDropOpening();
    state.receivedCards = cards.length > 1 ? cards : [];
    state.collectionMode = "cards";
    state.collectionSelected.clear();
    state.selectMode = false;
    showPage("collection");
    window.scrollTo({ top: 0 });
    if (card) openCardSheet(card);
  }

  async function presentDrop(result, isFreeDrop) {
    const session = dropSession;
    setBalance(result.balance);
    if (Number.isInteger(result.crystals)) setCrystals(result.crystals);
    if (Number.isInteger(result.rolls)) setRolls(result.rolls);
    if (isFreeDrop && state.profile) {
      state.profile.free_drops = result.free_drops;
      state.profile.drop_cooldown = result.drop_cooldown;
      state.dropReadyAt = Date.now() + (result.free_drops.next_in || 0) * 1000;
    }
    const cards = result.cards || [result.card];
    state.lastDropCard = cards.length === 1 ? cards[0] : null;
    state.ownedCardCount += cards.length;
    el("card-count").textContent = state.ownedCardCount;
    state.homeCards = [...cards, ...state.homeCards.filter((item) => !cards.some((newCard) => newCard.id === item.id))].slice(0, 10);
    renderHome();
    clearTimeout(state.dropStageTimer);
    if (session && !session.cancelled) {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!reduced) {
        await dropWait(session, Math.max(0, DROP_MIN_OPEN_MS - (performance.now() - state.dropStartedAt)));
        for (let index = 0; index < cards.length && !session.skipped && !session.cancelled; index += 1) {
          await revealDrop(cards[index], index, cards.length, session);
        }
      }
      if (!session.cancelled) showDropResults(cards);
    }
    if (isFreeDrop) updateDropTimer();
    else updateDropButton();
  }

  async function openDrop(all = false) {
    if (state.dropBusy) return;
    state.dropBusy = true;
    el("drop-button").disabled = true;
    el("drop-all-button").disabled = true;
    el("ticket-drop-button").disabled = true;
    startDropOpening();
    try {
      const result = await api(all ? "/api/drop/all" : "/api/drop", { method: "POST", body: "{}" });
      await presentDrop(result, true);
    } catch (error) {
      closeDropOpening();
      showError(error);
      await loadProfile().catch(showDropLoadError);
    } finally {
      state.dropBusy = false;
      updateDropButton();
    }
  }
  async function openExtraRoll() {
    if (state.dropBusy) return;
    state.dropBusy = true;
    el("drop-button").disabled = true;
    el("drop-all-button").disabled = true;
    el("ticket-drop-button").disabled = true;
    startDropOpening();
    try {
      const result = await api("/api/drop/extra", { method: "POST", body: "{}" });
      await presentDrop(result, false);
    } catch (error) {
      closeDropOpening();
      showError(error);
      await loadProfile().catch(showDropLoadError);
    } finally {
      state.dropBusy = false;
      updateDropButton();
    }
  }

  function renderChips(containerId, items, current, onPick) {
    const row = el(containerId);
    row.replaceChildren();
    items.forEach((item) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = `filter-chip${item.key === current ? " active" : ""}`;
      chip.textContent = item.title;
      chip.setAttribute("aria-pressed", String(item.key === current));
      chip.addEventListener("click", () => {
        haptic("light");
        onPick(item.key);
      });
      row.append(chip);
    });
  }

  function renderCollection() {
    const container = el("collection-cards");
    el("collection-count").textContent = formatCardCount(state.collectionTotal);
    el("collection-page-label").textContent =
      state.collectionPages > 1 ? `${state.collectionPage} / ${state.collectionPages}` : "";
    if (!state.collectionItems.length) {
      container.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.gridColumn = "1 / -1";
      const filtered = state.collectionQuery || state.collectionRarity;
      empty.textContent = filtered ? "Карты не найдены. Измените поиск или сбросьте фильтры."
        : state.collectionFilter === "favorites" ? "Избранных карт пока нет. Откройте карту и нажмите звёздочку."
        : state.collectionFilter === "recent" ? "За последние 7 дней новых карт нет."
        : "Коллекция пока пуста. Откройте первую карту на главной.";
      if (!filtered && !state.collectionFilter) {
        empty.append(displayButton("На главную", () => showPage("home")));
      }
      container.append(empty);
      return;
    }
    container.replaceChildren();
    state.collectionItems.forEach((card) => {
      const selected = state.collectionSelected.has(card.id);
      container.append(cardButton(card, selected, Boolean(card.lock_reason), (event) => {
        if (event.longPress && !state.selectMode) {
          state.selectMode = true;
          state.collectionSelected.set(card.id, card);
          renderCollectionSelection();
          renderCollection();
          return;
        }
        if (state.selectMode) {
          if (state.collectionSelected.has(card.id)) state.collectionSelected.delete(card.id);
          else if (state.collectionSelected.size < 10) state.collectionSelected.set(card.id, card);
          else showToast("Можно выбрать до 10 карт.");
          if (!state.collectionSelected.size) state.selectMode = false;
          renderCollectionSelection();
          renderCollection();
          return;
        }
        openCardSheet(card);
      }, ""));
    });
  }

  async function loadCollection(page = 1, reset = false) {
    if (state.collectionLoading && !reset) return;
    const version = ++state.collectionVersion;
    state.collectionLoading = true;
    el("collection-more").disabled = true;
    if (reset) {
      state.collectionItems = [];
      el("collection-count").textContent = "Загрузка…";
      el("collection-page-label").textContent = "";
      el("collection-more").hidden = true;
      const container = el("collection-cards");
      container.replaceChildren();
      for (let index = 0; index < 6; index += 1) {
        const skeleton = document.createElement("div");
        skeleton.className = "skeleton skeleton-card";
        container.append(skeleton);
      }
    }
    const params = new URLSearchParams({
      page: String(page),
      sort: state.collectionSort,
    });
    if (state.collectionRarity) params.set("rarity", state.collectionRarity);
    if (state.collectionQuery) params.set("q", state.collectionQuery);
    if (state.collectionFilter) params.set(state.collectionFilter, "1");
    try {
      const [data, favorites] = await Promise.all([
        api(`/api/inventory?${params}`), reset ? api("/api/favorites") : null,
      ]);
      if (version !== state.collectionVersion) return;
      if (favorites) {
        state.favorites = favorites.items;
        state.favoriteLimit = favorites.limit;
      }
      state.collectionPage = data.page;
      state.collectionPages = data.pages;
      state.collectionTotal = data.total;
      setBalance(data.balance);
      el("collection-more").hidden = data.page >= data.pages;
      state.collectionItems = reset ? data.items : [...state.collectionItems, ...data.items];
      renderCollection();
      renderCollectionSelection();
    } catch (error) {
      if (version !== state.collectionVersion) return;
      if (reset) {
        el("collection-count").textContent = "";
        el("collection-cards").replaceChildren(displayButton("Повторить загрузку карт",
          () => loadCollection(1, true)));
      }
      throw error;
    } finally {
      if (version === state.collectionVersion) {
        state.collectionLoading = false;
        el("collection-more").disabled = false;
      }
    }
  }

  function renderCollectionSelection() {
    const cards = [...state.collectionSelected.values()];
    const oneCard = cards.length === 1;
    el("selection-label").textContent = `Выбрано: ${cards.length} / 10`;
    el("dust-selected").disabled = cards.length === 0;
    el("transfer-selected").disabled = cards.length === 0;
    el("sell-selected").disabled = !oneCard;
    const startPrice = el("auction-start-price");
    startPrice.disabled = !oneCard;
    if (oneCard && startPrice.dataset.cardId !== String(cards[0].id)) {
      startPrice.dataset.cardId = String(cards[0].id);
      startPrice.value = cards[0].dust_value;
    } else if (!oneCard) {
      startPrice.dataset.cardId = "";
      startPrice.value = "";
    }
    const bar = el("select-bar");
    bar.hidden = !state.selectMode || state.activePage !== "collection" || state.collectionMode !== "cards";
    el("select-bar-label").textContent = `Выбрано ${cards.length}`;
  }

  function refreshCollection() {
    const mode = state.collectionMode;
    el("collection-catalog").hidden = mode !== "cards";
    el("collection-albums").hidden = mode !== "albums";
    el("collection-duplicates").hidden = mode !== "duplicates";
    document.querySelectorAll("[data-collection-mode]").forEach((button) => {
      const active = button.dataset.collectionMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (mode === "albums") loadCollectionAlbums(albums.page).catch(showError);
    if (mode === "duplicates") {
      copies.selected.clear();
      loadCollectionCopies(copies.page).catch(showError);
    }
    if (mode === "cards") {
      renderReceivedCards();
      renderCollectionFilters();
      reloadCatalog();
    }
  }

  function setCollectionMode(mode) {
    if (mode === state.collectionMode) return;
    state.collectionMode = mode;
    if (state.selectMode || state.collectionSelected.size) clearCollectionSelection();
    refreshCollection();
  }

  function renderReceivedCards() {
    el("collection-received").hidden = !state.receivedCards.length;
    el("collection-received-cards").replaceChildren(...state.receivedCards.map((card) =>
      cardButton(card, false, Boolean(card.lock_reason), () => openCardSheet(card), "")));
  }

  function clearCollectionSelection() {
    state.collectionSelected.clear();
    state.selectMode = false;
    renderCollectionSelection();
  }

  function reloadCatalog() {
    clearTimeout(state.collectionSearchTimer);
    loadCollection(1, true).catch(showError);
  }

  function renderCollectionFilters() {
    const bind = (id, items, key) => renderChips(id, items, state[key], (value) => {
      if (state[key] === value) return;
      state[key] = value;
      clearCollectionSelection();
      renderCollectionFilters();
      reloadCatalog();
    });
    bind("collection-quick-chips", COLLECTION_FILTERS, "collectionFilter");
    bind("rarity-chips", RARITIES, "collectionRarity");
    bind("sort-chips", SORTS, "collectionSort");
    const rarity = RARITIES.find(({ key }) => key && key === state.collectionRarity)?.title;
    const sort = state.collectionSort !== "new" && SORTS.find(({ key }) => key === state.collectionSort)?.title;
    el("collection-filter-summary").textContent = ["Фильтры и сортировка", rarity, sort].filter(Boolean).join(" · ");
    updateCollectionReset();
  }

  function updateCollectionReset() {
    el("collection-reset").hidden = !(
      state.collectionFilter || state.collectionRarity || state.collectionQuery || state.collectionSort !== "new");
  }

  function renderCollectionPages(id, data) {
    const controls = el(id);
    controls.hidden = data.pages <= 1;
    controls.querySelector("span").textContent = `${data.page} / ${data.pages}`;
    const [previous, next] = controls.querySelectorAll("button");
    previous.disabled = data.page <= 1;
    next.disabled = data.page >= data.pages;
  }

  function collectionRow(title, description, button = null) {
    const row = document.createElement(button ? "button" : "div");
    row.className = button ? "btn btn-secondary collection-row" : "collection-row";
    const name = document.createElement("strong");
    const details = document.createElement("span");
    name.textContent = title;
    details.className = "hint";
    details.textContent = description;
    row.append(name, details);
    if (button) {
      row.type = "button";
      row.addEventListener("click", button);
    }
    return row;
  }

  async function loadCollectionAlbums(page) {
    const version = ++albums.version;
    const series = albums.series;
    const list = el("collection-album-items");
    const status = el("collection-album-status");
    el("collection-album-title").textContent = series ?? "Альбомы по сериям";
    el("collection-album-back").hidden = series === null;
    el("collection-album-links").hidden = series !== null;
    el("collection-album-pages").hidden = true;
    status.textContent = "Загружаем альбомы…";
    list.replaceChildren();
    const params = new URLSearchParams({ page: String(page) });
    if (series !== null) params.set("series", series);
    try {
      const data = await api(`/api/collection/albums?${params}`);
      if (version !== albums.version) return;
      albums.page = data.page;
      if (series === null) {
        status.textContent = data.total ? "Откройте серию, чтобы посмотреть, кого ещё не хватает."
          : "Альбом появится после получения первой карты из серии.";
        for (const item of data.items) {
          const row = collectionRow(item.series, `Собрано ${item.owned} из ${item.total}`, () => {
            albums.listPage = albums.page;
            albums.series = item.series;
            loadCollectionAlbums(1).catch(showError);
          });
          const progress = document.createElement("progress");
          progress.value = item.owned;
          progress.max = item.total;
          progress.setAttribute("aria-hidden", "true");
          row.append(progress);
          list.append(row);
        }
      } else {
        status.textContent = `Собрано ${data.owned} из ${data.total} · не хватает: ${data.total - data.owned}`;
        for (const { name, card } of data.items) {
          list.append(collectionRow(name, card ? `В коллекции · ${card.rarity_title}` : "Ещё не получена",
            card ? () => openCardSheet(card) : null));
        }
      }
      renderCollectionPages("collection-album-pages", data);
    } catch (error) {
      if (version !== albums.version) return;
      status.textContent = "Не удалось загрузить альбомы.";
      list.append(displayButton("Повторить", () => loadCollectionAlbums(page)));
      throw error;
    }
  }

  function updateCopySelection() {
    const value = [...copies.selected.values()].reduce((total, card) => total + card.dust_value, 0);
    el("collection-copy-selection").textContent = `Выбрано: ${copies.selected.size} · Получите ${value} пыли`;
    el("collection-copy-review").disabled = !copies.selected.size || copies.busy;
  }

  async function loadCollectionCopies(page) {
    const version = ++copies.version;
    const list = el("collection-copy-items");
    const status = el("collection-copy-status");
    status.textContent = "Загружаем лишние копии…";
    el("collection-copy-pages").hidden = true;
    el("collection-copy-actions").hidden = true;
    list.replaceChildren();
    try {
      const data = await api(`/api/collection/duplicates?page=${page}`);
      if (version !== copies.version) return;
      copies.page = data.page;
      copies.maxBatch = data.max_batch;
      status.textContent = data.total ? `Доступно для распыления: ${data.total}` : "Нет копий для безопасного распыления.";
      const rows = data.items.map((card) => {
        const label = document.createElement("label");
        label.className = "collection-copy";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = copies.selected.has(card.id);
        checkbox.disabled = copies.busy;
        checkbox.addEventListener("change", () => {
          if (!checkbox.checked) copies.selected.delete(card.id);
          else if (copies.selected.size < copies.maxBatch) copies.selected.set(card.id, card);
          else {
            checkbox.checked = false;
            showToast(`Можно выбрать до ${copies.maxBatch} карт.`);
          }
          updateCopySelection();
        });
        label.append(checkbox, collectionRow(card.name,
          `Экземпляр №${card.print_no} · Всего: ${card.owned_count} · ${card.dust_value} пыли`));
        return label;
      });
      list.append(...rows);
      el("collection-copy-actions").hidden = !data.total;
      renderCollectionPages("collection-copy-pages", data);
      updateCopySelection();
    } catch (error) {
      if (version !== copies.version) return;
      status.textContent = "Не удалось загрузить копии.";
      list.append(displayButton("Повторить", () => loadCollectionCopies(page)));
      throw error;
    }
  }

  function reviewCollectionCopies() {
    if (copies.busy || !copies.selected.size) return;
    const cards = [...copies.selected.values()];
    const estimate = cards.reduce((total, card) => total + card.dust_value, 0);
    const groups = new Map();
    for (const card of cards) {
      if (!groups.has(card.character_id)) groups.set(card.character_id, []);
      groups.get(card.character_id).push(card);
    }
    const body = document.createElement("div");
    body.className = "collection-list";
    for (const group of groups.values()) {
      const [card] = group;
      body.append(collectionRow(card.name,
        `Распылить №${group.map((item) => item.print_no).join(", №")} · Останется: ${card.owned_count - group.length}`));
    }
    const warning = document.createElement("p");
    warning.className = "hint";
    warning.textContent = `Вы получите ${estimate} пыли. Действие нельзя отменить.`;
    const cancel = displayButton("Вернуться к выбору", closeSheet);
    const confirm = displayButton(`Распылить · ${formatCardCount(cards.length)}`, async () => {
      if (copies.busy) return;
      copies.busy = true;
      confirm.disabled = true;
      cancel.disabled = true;
      updateCopySelection();
      try {
        const result = await api("/api/dust/duplicates", {
          method: "POST", body: JSON.stringify({ card_ids: cards.map(({ id }) => id), estimate }),
        });
        removeDustedCards(result);
        showNotice(`Распылено карт: ${result.card_ids.length}. Получено ${result.amount} пыли.`);
        haptic("success");
      } catch (error) { showError(error); }
      finally {
        copies.busy = false;
        copies.selected.clear();
        if (body.isConnected && !el("sheet").hidden) closeSheet();
        if (state.activePage === "collection") refreshCollection();
      }
    });
    confirm.className = "btn btn-danger btn-block";
    body.append(warning, confirm, cancel);
    openSheet("Проверьте распыление", body);
  }

  async function toggleFavorite(card) {
    const current = await api("/api/favorites");
    const favoriteIds = new Set(current.items.map((favorite) => favorite.id));
    const added = !favoriteIds.delete(card.id);
    if (added) favoriteIds.add(card.id);
    const result = await api("/api/favorites", {
      method: "POST",
      body: JSON.stringify({ card_ids: [...favoriteIds] }),
    });
    state.favorites = result.items;
    state.favoriteLimit = result.limit;
    haptic("success");
    return added;
  }

  function closeSheet() {
    el("sheet").classList.remove("sheet--card");
    el("sheet").hidden = true;
    el("sheet-backdrop").hidden = true;
    clearMainButton();
    syncBackButton();
  }
  function openSheet(title, body, main) {
    el("sheet").classList.remove("sheet--card");
    el("sheet-title").textContent = title;
    el("sheet-body").replaceChildren(body);
    el("sheet").hidden = false;
    el("sheet").scrollTop = 0;
    el("sheet-backdrop").hidden = false;
    if (main) setMainButton(main.text, main.onClick);
    else clearMainButton();
    syncBackButton();
  }

  function openCardSheet(card, { revealUpgrade = false, previousImageUrl } = {}) {
    if (!revealUpgrade) haptic("light");
    const body = document.createElement("div");
    const preview = cardButton(card, false, false, null, "", previousImageUrl);
    preview.classList.add("sheet-card");
    body.classList.toggle("card-upgrade-complete", revealUpgrade);
    preview.disabled = true;
    const actions = document.createElement("div");
    actions.className = "sheet-actions";
    const otherActions = document.createElement("div");
    otherActions.className = "sheet-actions";
    const more = document.createElement("details");
    more.className = "card-more-actions";
    const summary = document.createElement("summary");
    summary.textContent = "Обмен, передача и другие действия";
    more.append(summary, otherActions);
    const frameStatus = document.createElement("p");
    frameStatus.className = "hint card-frame-status";
    const lockLabels = { listing: "на аукционе", trade: "в обмене", transfer: "в передаче" };
    frameStatus.textContent = [card.rarity_title, `Рамка: ${card.style_title || "Стандартная"} · ${card.frame_rarity_title || card.rarity_title}`,
      `Эффект: ${state.profile?.economy?.upgrade_effects?.[(card.upgrade_level || 0) - 1]?.title || "Без улучшений"}`,
      card.lock_reason ? `Заблокирована: ${lockLabels[card.lock_reason] || "занята"}` : ""]
      .filter(Boolean).join(" · ");
    const isFavorite = state.favorites.some((favorite) => favorite.id === card.id);
    const buttons = [
      [isFavorite ? "★ В избранном" : "☆ В избранное", "secondary", async (button) => {
        button.disabled = true;
        try {
          const added = await toggleFavorite(card);
          if (state.activePage === "collection" && state.collectionMode === "cards") {
            if (state.collectionFilter === "favorites") reloadCatalog();
            else if (!state.collectionLoading) renderCollection();
            renderReceivedCards();
          }
          button.textContent = added ? "★ В избранном" : "☆ В избранное";
          button.setAttribute("aria-pressed", String(added));
          showNotice(added ? "Добавлено в избранное." : "Убрано из избранного.");
        } catch (error) { showError(error); }
        finally { button.disabled = false; }
      }],
      ["Выставить на аукцион", "secondary", () => openSellSheet(card)],
      ["Предложить обмен", "secondary", () => {
        if (state.tradeToken) {
          showNotice("Завершите текущий обмен, чтобы создать новое предложение.");
          return;
        }
        state.selected = new Map([[card.id, card]]);
        state.marketTab = "trade";
        closeSheet();
        showPage("trade");
      }],
      ["Передать", "secondary", async () => {
        state.collectionSelected = new Map([[card.id, card]]);
        await transferSelected();
      }],
      [`Распылить за ${card.dust_value} пыли`, "danger", async () => {
        state.collectionSelected = new Map([[card.id, card]]);
        closeSheet();
        await dustSelected();
      }],
    ];
    buttons.forEach(([label, kind, handler]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `btn btn-${kind} btn-block`;
      button.textContent = label;
      const favoriteAction = label.startsWith("★") || label.startsWith("☆");
      if (favoriteAction) button.setAttribute("aria-pressed", String(isFavorite));
      if (card.lock_reason && !favoriteAction) {
        button.disabled = true;
      }
      button.addEventListener("click", () => handler(button));
      (favoriteAction ? actions : otherActions).append(button);
    });
    const level = card.upgrade_level || 0;
    const upgradePrice = state.profile?.economy?.upgrade_prices[level];
    const upgradeEffect = state.profile?.economy?.upgrade_effects?.[level];
    if (upgradePrice !== undefined) {
      const upgrade = document.createElement("button");
      upgrade.type = "button";
      upgrade.className = "btn btn-secondary btn-block";
      upgrade.textContent = `Улучшить: ${upgradeEffect?.title || "новый эффект"} · ${upgradePrice} пыли`;
      upgrade.disabled = Boolean(card.lock_reason) || state.balance < upgradePrice;
      upgrade.addEventListener("click", () => upgradeCard(card, upgrade, upgradePrice));
      actions.append(upgrade);
    }
    const manageFrame = document.createElement("button");
    manageFrame.type = "button";
    manageFrame.className = "btn btn-secondary btn-block card-frame-manage";
    manageFrame.textContent = hasCustomFrame(card) ? "Сменить или снять рамку" : "Надеть рамку";
    manageFrame.disabled = Boolean(card.lock_reason);
    manageFrame.addEventListener("click", () => openFramePicker(card));
    body.append(preview, frameStatus, manageFrame, actions, more);
    openSheet(card.name, body);
    el("sheet").classList.add("sheet--card");
  }

  async function loadFramesCatalog() {
    const shop = await api("/api/frames");
    state.shopFrames = shop.items;
    state.framePacks = shop.packs;
    setCrystals(shop.crystals);
    setBalance(shop.balance);
    return state.shopFrames;
  }

  function applyCardUpdate(updated) {
    const replace = (items) => items.map((item) => item.id === updated.id ? updated : item);
    state.collectionItems = replace(state.collectionItems);
    state.homeCards = replace(state.homeCards);
    state.receivedCards = replace(state.receivedCards);
    state.favorites = replace(state.favorites);
    state.inventory = replace(state.inventory);
    state.frameShopCards = replace(state.frameShopCards);
    if (state.frameShopPinnedCard?.id === updated.id) state.frameShopPinnedCard = updated;
    for (const selection of [state.collectionSelected, state.selected]) {
      if (selection.has(updated.id)) selection.set(updated.id, updated);
    }
  }

  function openFrameShop(card) {
    state.frameShopPinnedCard = card;
    state.frameShopCardId = card.id;
    closeSheet();
    setShopTab("frames", false);
    showPage("crystals", { loadShop: false });
    loadFrameShop().then(() => {
      if (state.activePage === "crystals" && state.shopTab === "frames") {
        el("frame-shop-preview").scrollIntoView({ block: "start" });
      }
    }).catch(showError);
  }

  async function openFramePicker(card, { frameId, onBack = openCardSheet } = {}) {
    haptic("light");
    const body = document.createElement("div");
    body.className = "frame-picker-body";
    const status = document.createElement("p");
    status.className = "hint";
    status.setAttribute("role", "status");
    status.textContent = "Загружаем ваши рамки…";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn-secondary";
    back.textContent = "Назад";
    back.addEventListener("click", () => onBack(card));
    body.append(back, status);
    openSheet(`Рамка · ${card.name}`, body);

    let frames;
    try {
      frames = await loadFramesCatalog();
    } catch (error) {
      status.textContent = "Не удалось загрузить рамки.";
      showError(error);
      return;
    }
    if (!body.isConnected || el("sheet").hidden) return;
    const owned = [{ id: "classic", title: "Стандартная", rarity: card.rarity, available: 1 },
      ...frames.filter((frame) => frame.owned)];
    const intro = document.createElement("p");
    intro.className = "hint";
    intro.textContent = owned.length === 1
      ? "У вас пока нет особых рамок. Их можно получить в магазине или в кейсе."
      : "Каждый экземпляр можно надеть на одну карту. Чтобы вернуть рамку в инвентарь, выберите «Стандартная» и нажмите «Снять рамку».";
    const visual = document.createElement("div");
    visual.className = "frame-picker-preview";
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "btn btn-primary btn-block";
    const grid = document.createElement("div");
    grid.className = "frame-picker";
    const options = new Map();
    let selected;
    let previewVersion = 0;
    let saving = false;

    async function selectFrame(frame) {
      if (saving || selected === frame) return;
      selected = frame;
      const version = ++previewVersion;
      const current = frame.id === card.frame_style;
      for (const [id, option] of options) {
        option.classList.toggle("selected", id === frame.id);
        option.setAttribute("aria-pressed", String(id === frame.id));
      }
      apply.disabled = current || Boolean(card.lock_reason);
      apply.textContent = current ? "Уже на карте" : frame.id === "classic" ? "Снять рамку" : "Надеть рамку";
      visual.replaceChildren();
      status.textContent = "Загружаем примерку…";
      try {
        const url = await loadCardImageUrl(card, "", frame.id);
        if (version !== previewVersion || !body.isConnected) return;
        const image = document.createElement("img");
        image.src = url;
        image.alt = `${card.name} · ${frame.title}`;
        visual.append(image);
        const fx = frameEffects(frame.effect, card.rarity, frame.rarity, frame.accent, frame.ornament_url, frame.style);
        if (fx) visual.append(fx);
        status.textContent = current ? `Сейчас на карте: ${frame.title}` : `Примерка: ${frame.title}`;
      } catch {
        if (version === previewVersion) status.textContent = "Не удалось загрузить примерку.";
      }
    }

    owned.forEach((frame) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "frame-option";
      option.dataset.rarity = frame.rarity;
      const current = frame.id === card.frame_style;
      option.disabled = !current && !frame.available;
      if (frame.preview_url) {
        const thumbnail = document.createElement("img");
        thumbnail.className = "frame-preview";
        thumbnail.alt = "";
        thumbnail.loading = "lazy";
        thumbnail.src = frameAssetUrl(frame.preview_url);
        option.append(thumbnail);
      }
      const title = document.createElement("strong");
      title.textContent = frame.title;
      const meta = document.createElement("span");
      meta.className = "hint";
      meta.textContent = current ? "На этой карте" : frame.id === "classic" ? "Без особой рамки" : frameStockLabel(frame);
      option.append(title, meta);
      option.addEventListener("click", () => selectFrame(frame));
      options.set(frame.id, option);
      grid.append(option);
    });
    apply.addEventListener("click", async () => {
      if (saving || apply.disabled) return;
      saving = true;
      apply.disabled = true;
      apply.textContent = "Сохраняем…";
      try {
        const updated = await equipFrame(card, selected);
        if (body.isConnected && !el("sheet").hidden) onBack(updated);
      } catch (error) {
        showError(error);
        if (body.isConnected && !el("sheet").hidden) openFramePicker(card, { frameId: selected.id, onBack });
      } finally {
        saving = false;
      }
    });
    body.replaceChildren(back, intro, visual, status, grid, apply, frameShopButton(card));
    const initial = owned.find((frame) => frame.id === frameId && (frame.available || frame.id === card.frame_style))
      || owned.find((frame) => frame.id === card.frame_style) || owned[0];
    selectFrame(initial);
  }

  function frameStockLabel(frame) {
    if (!frame.owned) return "Не получена";
    if (frame.available) return `Свободно: ${frame.available}${frame.equipped_count ? ` · Надето: ${frame.equipped_count}` : ""}`;
    return frame.equipped_card_id ? `На карте #${frame.equipped_card_id}` : `Надето: ${frame.equipped_count}`;
  }

  function frameShopButton(card) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary btn-block";
    button.textContent = "Купить ещё рамки";
    button.addEventListener("click", () => openFrameShop(card));
    return button;
  }

  function openSellSheet(card) {
    const body = document.createElement("div");
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Стартовая ставка · пыль";
    const input = document.createElement("input");
    input.className = "field";
    input.type = "number";
    input.min = "1";
    input.step = "1";
    input.inputMode = "numeric";
    input.value = card.dust_value;
    el("auction-start-price").value = card.dust_value;
    body.append(hint, input);
    const submit = async () => {
      el("auction-start-price").value = input.value;
      state.collectionSelected = new Map([[card.id, card]]);
      closeSheet();
      await sellSelected();
    };
    openSheet("Продать карту", body);
    if (!setMainButton("Создать лот", submit)) {
      const local = document.createElement("button");
      local.type = "button";
      local.className = "btn btn-primary btn-block";
      local.textContent = "Создать лот";
      local.addEventListener("click", submit);
      body.append(local);
    }
  }

  function openBidSheet(listing) {
    const body = document.createElement("div");
    body.className = "bid-form";
    const balance = document.createElement("p");
    balance.className = "hint";
    balance.textContent = `Доступно: ${state.balance} пыли · минимум ${listing.minimum_bid}`;
    const input = document.createElement("input");
    input.className = "field";
    input.type = "number";
    input.min = listing.minimum_bid;
    input.value = listing.minimum_bid;
    input.inputMode = "numeric";
    input.setAttribute("aria-label", "Сумма ставки в пыли");
    const row = document.createElement("div");
    row.className = "bid-row";
    const setAmount = (value) => { input.value = Math.max(listing.minimum_bid, Math.ceil(value)); };
    [["минимум", listing.minimum_bid],
      ["+5%", listing.minimum_bid * 1.05],
      ["+10%", listing.minimum_bid * 1.1]].forEach(([label, value]) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn btn-secondary";
      button.textContent = label;
      button.addEventListener("click", () => setAmount(value));
      row.append(button);
    });
    const submit = async () => {
      const bidAmount = Number(input.value);
      if (!Number.isSafeInteger(bidAmount) || bidAmount < listing.minimum_bid) {
        showError(new Error(`Минимальная следующая ставка — ${listing.minimum_bid} пыли.`));
        return;
      }
      if (!await confirmAction(
        `Поставить ${bidAmount} пыли? Сумма будет зарезервирована до конца аукциона.`)) return;
      try {
        const result = await api(`/api/market/${listing.id}/bid`, {
          method: "POST",
          body: JSON.stringify({ amount: bidAmount }),
        });
        setBalance(result.balance);
        closeSheet();
        await loadMarket();
        await loadProfile();
        showNotice(`Ставка ${bidAmount} пыли принята.`);
        haptic("success");
      } catch (error) { showError(error); }
    };
    const local = document.createElement("button");
    local.type = "button";
    local.className = "btn btn-primary btn-block";
    local.textContent = "Подтвердить ставку";
    local.addEventListener("click", submit);
    body.append(balance, row, input, local);
    openSheet("Ставка", body);
  }

  function listingCard(listing, { mine = false } = {}) {
    const item = document.createElement("article");
    item.className = "listing";
    item.append(cardButton(listing.card, false, true, () => {}, ""));
    const body = document.createElement("div");
    body.className = "listing-body";
    const title = document.createElement("strong");
    title.className = "listing-title";
    title.textContent = listing.card.name;
    const rarity = document.createElement("span");
    rarity.className = "listing-rarity";
    rarity.textContent = listing.card.rarity_title;
    const time = document.createElement("div");
    time.className = "listing-time";
    time.dataset.auctionExpiry = String(listing.expires_at);
    const current = document.createElement("div");
    current.className = "listing-meta";
    current.textContent = listing.current_bid === null
      ? `Старт · ${listing.starting_price} пыли`
      : `Ставка · ${listing.current_bid} пыли`;
    const bids = document.createElement("div");
    bids.className = "listing-meta";
    bids.textContent = `Ставок: ${listing.bid_count}`;
    body.append(title, rarity, time, current, bids);
    if (listing.highest_bidder_is_me) {
      const lead = document.createElement("span");
      lead.className = "lead-badge";
      lead.textContent = "Вы лидируете";
      body.append(lead);
    }
    if (mine) {
      if (listing.can_cancel) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn btn-danger";
        cancel.textContent = "Снять";
        cancel.addEventListener("click", async () => {
          try {
            await api(`/api/listings/${listing.id}`, { method: "DELETE" });
            await loadAccount();
            await loadMyListings();
            showNotice(`Аукцион #${listing.id} отменён.`);
          } catch (error) { showError(error); }
        });
        body.append(cancel);
      }
    } else {
      const bid = document.createElement("button");
      bid.type = "button";
      bid.className = "btn btn-primary";
      bid.textContent = listing.highest_bidder_is_me ? "Повысить" : "Ставка";
      bid.disabled = listing.seller_id === state.profile?.id;
      bid.addEventListener("click", () => openBidSheet(listing));
      body.append(bid);
    }
    item.append(body);
    return item;
  }

  async function loadMarket() {
    const data = await api("/api/market");
    state.marketItems = data.items;
    const container = el("market-cards");
    container.replaceChildren();
    if (!data.items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Активных аукционов пока нет.";
      container.append(empty);
      return;
    }
    data.items.forEach((listing) => container.append(listingCard(listing)));
    updateAuctionCountdowns();
  }

  async function loadMyListings() {
    const data = await api("/api/listings");
    const container = el("my-market-listings");
    container.replaceChildren();
    if (!data.items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Своих лотов пока нет.";
      container.append(empty);
      return;
    }
    data.items.forEach((listing) => container.append(listingCard(listing, { mine: true })));
    updateAuctionCountdowns();
  }

  function setMarketTab(name, initial = false) {
    state.marketTab = name;
    document.querySelectorAll("[data-market-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.marketTab === name);
    });
    el("market-pane").hidden = name !== "all";
    el("mine-pane").hidden = name !== "mine";
    el("trade-pane").hidden = name !== "trade";
    if (name === "all") loadMarket().catch(showError);
    if (name === "mine") loadMyListings().catch(showError);
    if (name === "trade") {
      if (state.tradeToken) loadTrade().catch(showError);
      else loadInventory().catch(showError);
    }
    if (!initial) haptic("light");
  }

  function renderEconomyStatus() {
    const economy = state.profile?.economy;
    const button = el("dust-ticket-buy");
    button.disabled = !economy || state.economyBusy || !economy.dust_ticket_available || state.balance < economy.dust_ticket_cost;
    button.textContent = !economy ? "Загружаем…" : economy.dust_ticket_available
      ? `Купить билет · ${economy.dust_ticket_cost} пыли` : "Сегодня уже куплен";
    el("craft-status").textContent = !economy ? "Загружаем…" : economy.craft_available
      ? `Создание доступно · На балансе ${state.balance} пыли`
      : `Следующее создание: ${new Date(economy.craft_available_at * 1000).toLocaleString("ru-RU")} (ваше время)`;
  }

  async function purchaseDustTicket() {
    if (state.economyBusy || !state.profile?.economy?.dust_ticket_available) return;
    state.economyBusy = true;
    renderEconomyStatus();
    try {
      if (!await showShopDialog({ title: "Билет за пыль", item: "1 билет",
        description: "Одна покупка в сутки, до 00:00 по Москве.", art: "ticket",
        price: state.profile.economy.dust_ticket_cost, currency: "dust" })) return;
      const result = await api("/api/rolls/dust", { method: "POST", body: "{}" });
      setBalance(result.balance);
      setRolls(result.rolls);
      state.profile.economy.dust_ticket_available = false;
      showNotice("Билет добавлен. Его можно использовать для открытия карты.");
      haptic("success");
    } catch (error) { showError(error); }
    finally { state.economyBusy = false; renderEconomyStatus(); }
  }

  async function loadCraftCatalog(after = 0) {
    const version = ++state.craftVersion;
    const rarity = el("craft-rarity").value;
    const query = el("craft-query").value;
    const results = el("craft-results");
    results.textContent = "Загружаем персонажей…";
    el("craft-next").hidden = true;
    try {
      const data = await api(`/api/craft?${new URLSearchParams({ rarity, q: query, after })}`);
      if (version !== state.craftVersion) return;
      results.replaceChildren();
      state.craftAfter = data.next_after;
      for (const character of data.items) {
        const row = document.createElement("article");
        row.className = "craft-character";
        const label = document.createElement("div");
        const name = document.createElement("strong");
        name.textContent = character.name;
        const series = document.createElement("span");
        series.className = "hint";
        series.textContent = character.series;
        label.append(name, series);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-secondary";
        button.textContent = `Создать · ${character.price} пыли`;
        button.disabled = !state.profile?.economy?.craft_available || state.balance < character.price || state.economyBusy;
        button.addEventListener("click", () => createCharacterCard(character));
        row.append(label, button);
        results.append(row);
      }
      if (!data.items.length) results.textContent = "Персонажи не найдены. Попробуйте другое имя или редкость.";
      el("craft-next").hidden = data.next_after === null;
    } catch (error) {
      if (version === state.craftVersion) results.textContent = "Не удалось загрузить персонажей. Нажмите «Найти», чтобы повторить.";
      throw error;
    }
  }

  async function createCharacterCard(character) {
    if (state.economyBusy) return;
    state.economyBusy = true;
    try {
      if (!await showShopDialog({ title: "Создание карты", item: character.name,
        description: `${character.series}. Следующее создание будет доступно через 7 дней.`,
        art: "frame", price: character.price, currency: "dust" })) return;
      const result = await api("/api/craft", { method: "POST",
        body: JSON.stringify({ character_id: character.id, rarity: character.rarity }) });
      setBalance(result.balance);
      state.profile.economy.craft_available = false;
      state.profile.economy.craft_available_at = result.craft_available_at;
      renderEconomyStatus();
      // Mark the existing catalog unavailable immediately, even if the refresh fails.
      el("craft-results").querySelectorAll("button").forEach((button) => { button.disabled = true; });
      showNotice(`Карта «${result.card.name}» создана и добавлена в коллекцию.`);
      haptic("success");
      await loadProfile();
    } catch (error) { showError(error); }
    finally { state.economyBusy = false; renderEconomyStatus(); }
  }

  async function upgradeCard(card, button, price) {
    if (state.economyBusy) return;
    state.economyBusy = true;
    button.disabled = true;
    const label = button.textContent;
    try {
      const effect = state.profile?.economy?.upgrade_effects?.[card.upgrade_level || 0];
      if (!await showShopDialog({ title: "Эффект иллюстрации", item: effect?.title || card.name,
        description: `${effect?.description || "Улучшение визуального эффекта."} Меняется только иллюстрация. Эффект передаётся с картой; при распылении стоимость улучшения не возвращается.`,
        art: "frame", price, currency: "dust" })) return;
      button.textContent = "Улучшаем карту…";
      const previewImage = button.closest("#sheet-body")?.querySelector(".sheet-card > img");
      const result = await api(`/api/cards/${card.id}/upgrade`, { method: "POST",
        body: JSON.stringify({ expected_level: card.upgrade_level || 0 }) });
      setBalance(result.balance);
      applyCardUpdate(result.card);
      if (button.isConnected && !el("sheet").hidden) {
        openCardSheet(result.card, {
          revealUpgrade: true,
          previousImageUrl: previewImage?.currentSrc,
        });
      }
      renderHome();
      renderFavorites();
      if (state.activePage === "collection") renderCollection();
      showNotice(`Добавлен эффект: ${effect?.title || result.upgrade_level}.`);
      haptic("success");
    } catch (error) { showError(error); }
    finally {
      state.economyBusy = false;
      button.textContent = label;
      button.disabled = Boolean(card.lock_reason) || state.balance < price;
      renderEconomyStatus();
    }
  }

  function renderCaseProgress() {
    const progress = state.caseCatalog?.progress;
    if (!progress) return;
    el("case-guarantee").textContent = progress.guarantee_in === null
      ? "Все рамки кейса собраны. Гарантия новой рамки пока не действует."
      : progress.guarantee_in === 1 ? "Следующее открытие гарантирует новую рамку!"
        : `Новая рамка гарантирована не позднее чем через ${progress.guarantee_in} открытий.`;
    el("case-shards").textContent = `Осколки: ${progress.frame_shards} / ${progress.shard_cost}. Дубликат даёт 80 пыли и 1 осколок.`;
    const select = el("case-shard-frame");
    const previous = select.value;
    select.replaceChildren();
    for (const frame of progress.missing_frames) {
      const option = document.createElement("option");
      option.value = frame.id;
      option.textContent = frame.title;
      select.append(option);
    }
    if (progress.missing_frames.some((frame) => frame.id === previous)) select.value = previous;
    select.disabled = !progress.missing_frames.length;
    el("case-shards-redeem").textContent = `Получить рамку · ${progress.shard_cost} осколков`;
    el("case-shards-redeem").disabled = state.caseOpening || state.economyBusy || !progress.missing_frames.length || progress.frame_shards < progress.shard_cost;
  }

  async function redeemFrameShards() {
    if (state.economyBusy || state.caseOpening) return;
    const frameId = el("case-shard-frame").value;
    const frame = state.caseCatalog?.progress.missing_frames.find((item) => item.id === frameId);
    if (!frame) return;
    state.economyBusy = true;
    renderCaseProgress();
    try {
      if (!await confirmAction(`Получить рамку «${frame.title}» за ${state.caseCatalog.progress.shard_cost} осколков? Счётчик гарантии новой рамки обнулится.`)) return;
      const result = await api("/api/cases/redeem", { method: "POST", body: JSON.stringify({ frame_id: frameId }) });
      state.caseCatalog.progress = result.progress;
      showNotice(`Получена рамка «${result.frame_title}».`);
      haptic("success");
    } catch (error) { showError(error); }
    finally { state.economyBusy = false; renderCaseProgress(); }
  }

  el("dust-ticket-buy").addEventListener("click", purchaseDustTicket);
  el("craft-search-form").addEventListener("submit", (event) => { event.preventDefault(); loadCraftCatalog().catch(showError); });
  el("craft-rarity").addEventListener("change", () => loadCraftCatalog().catch(showError));
  el("craft-next").addEventListener("click", () => loadCraftCatalog(state.craftAfter || 0).catch(showError));
  el("case-shards-redeem").addEventListener("click", redeemFrameShards);

  function setShopTab(name, load = true) {
    state.shopTab = name;
    const banners = {
      rolls: ["Билеты", "Откройте новые карточки!"],
      frames: ["Рамки", "Сделайте свои карточки особенными!"],
      cases: ["Кейсы", "Откройте ценные награды!"],
      craft: ["Создание", "Превратите пыль в нужного персонажа"],
    };
    const [title, description] = banners[name] || banners.rolls;
    el("shop-banner").dataset.kind = name;
    el("shop-banner-title").textContent = title;
    el("shop-banner-text").textContent = description;
    document.querySelectorAll("[data-shop-tab]").forEach((button) => {
      button.classList.toggle("active", button.dataset.shopTab === name);
    });
    el("rolls-pane").hidden = name !== "rolls";
    el("frames-pane").hidden = name !== "frames";
    el("cases-pane").hidden = name !== "cases";
    el("craft-pane").hidden = name !== "craft";
    if (name === "frames" && load) loadFrameShop().catch(showError);
    if (name === "cases") loadCaseCatalog().catch(showError);
    if (name === "craft") loadCraftCatalog().catch(showError);
    renderEconomyStatus();
  }

  function renderFavorites() {
    const container = el("favorite-cards");
    container.replaceChildren();
    el("favorite-count").textContent = `${state.favorites.length} / ${state.favoriteLimit}`;
    if (!state.favorites.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.gridColumn = "1 / -1";
      empty.textContent = "Пока нет избранных карт.";
      container.append(empty);
      return;
    }
    state.favorites.forEach((card, index) => {
      const item = document.createElement("div");
      item.className = "favorite-card-item";
      item.append(cardButton(card, false, false, () => openCardSheet(card), ""));
      const reorder = document.createElement("div");
      reorder.className = "favorite-reorder";
      [["↑", -1, "Выше"], ["↓", 1, "Ниже"]].forEach(([label, direction, title]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.title = `${title} в галерее`;
        button.setAttribute("aria-label", `${title} избранную карту`);
        button.disabled = index + direction < 0 ||
          index + direction >= state.favorites.length;
        button.addEventListener("click", () =>
          moveFavorite(card.id, direction).catch(showError));
        reorder.append(button);
      });
      item.append(reorder);
      container.append(item);
    });
  }

  async function moveFavorite(cardId, direction) {
    const ids = state.favorites.map((card) => card.id);
    const index = ids.indexOf(cardId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const result = await api("/api/favorites", {
      method: "POST",
      body: JSON.stringify({ card_ids: ids }),
    });
    state.favorites = result.items;
    state.favoriteLimit = result.limit;
    renderFavorites();
    if (state.activePage === "collection") renderCollection();
  }

  function renderAccountList(id, items, renderItem, emptyText) {
    const container = el(id);
    container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = emptyText;
      container.append(empty);
      return;
    }
    items.forEach((item) => container.append(renderItem(item)));
  }

  function createListingItem(listing, allowCancel) {
    const article = listingCard(listing, { mine: allowCancel });
    return article;
  }

  async function loadAccount() {
    const [profile, listings, transfers, favorites, rare, epic, legendary, mythical, referrals] = await Promise.all([
      fetchOwnProfile(), api("/api/listings"), api("/api/transfers"),
      api("/api/favorites"),
      api("/api/inventory?rarity=rare&page=1"),
      api("/api/inventory?rarity=epic&page=1"),
      api("/api/inventory?rarity=legendary&page=1"),
      api("/api/inventory?rarity=mythical&page=1"),
      api("/api/referrals"),
    ]);
    state.ownedCardCount = profile.card_count;
    state.favoriteLimit = profile.favorite_limit;
    state.favorites = favorites.items;
    updateProfileTier(profile);
    el("account-name").textContent = profile.display_name;
    el("welcome").textContent = `ID ${profile.id} · В игре с ${
      new Date(profile.created_at * 1000).toLocaleDateString("ru-RU")}`;
    el("vip-status-card").hidden = !profile.vip.active;
    el("vip-status-title").textContent = profile.vip.active
      ? `Активен до ${new Date(profile.vip.expires_at * 1000).toLocaleDateString("ru-RU")}`
      : "";
    el("vip-status-description").textContent = profile.vip.active
      ? "VIP-рамка профиля · значок · ускоренный дроп · бонусы пыли и наград"
      : "";
    el("account-card-count").textContent = profile.card_count;
    el("rare-count").textContent = rare.total + epic.total + legendary.total + mythical.total;
    el("legendary-count").textContent = legendary.total;
    el("trade-count").textContent = profile.successful_trades;
    setProfileAvatar("account-avatar", profile);
    Object.entries({
      "privacy-public": "is_public",
      "privacy-stats": "show_stats",
      "privacy-vip": "show_vip",
      "privacy-joined": "show_joined",
      "privacy-trades": "show_trades",
    }).forEach(([id, key]) => { el(id).checked = profile.privacy[key]; });
    renderReferrals(referrals);
    const bgSection = el("profile-background-section");
    const isVip = profile.vip.active;
    bgSection.hidden = !isVip;
    if (isVip) {
      await renderBackgroundSelector();
    }
    renderFavorites();
    renderAccountList("my-listings", listings.items, (listing) => {
      const article = createListingItem(listing, true);
      return article;
    }, "Активных лотов нет.");
    renderAccountList("my-transfers", transfers.items, (transfer) => {
      const article = document.createElement("article");
      article.className = "listing";
      const title = document.createElement("strong");
      title.textContent = `Передача #${transfer.id}`;
      const cards = document.createElement("span");
      cards.className = "listing-meta";
      cards.textContent = transfer.cards.map((card) => `#${card.id} ${card.name}`).join(", ");
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "btn btn-danger";
      cancel.textContent = "Отменить";
      cancel.addEventListener("click", async () => {
        try {
          await api(`/api/transfers/${transfer.id}`, { method: "DELETE" });
          await loadAccount();
          showNotice(`Передача #${transfer.id} отменена.`);
        } catch (error) { showError(error); }
      });
      article.append(title, cards, cancel);
      return article;
    }, "Активных передач нет.");
  }

  function loadBackgrounds() {
    if (!state.backgroundCatalogRequest) {
      state.backgroundCatalogRequest = fetch(new URL("static/backgrounds/backgrounds.json", staticBase))
        .then(async (res) => {
          if (!res.ok) throw new Error(`Не удалось загрузить фоны (${res.status}).`);
          const backgrounds = await res.json();
          state.availableBackgrounds = backgrounds;
          return backgrounds;
        })
        .catch(() => {
          state.backgroundCatalogRequest = null;
          return [];
        });
    }
    return state.backgroundCatalogRequest;
  }

  function backgroundImageUrl(background) {
    return new URL(`static/backgrounds/${background.preview || `${background.key}.jpg`}`, staticBase).href;
  }

  function syncAppBackground() {
    const profile = state.activePage === "player" ? state.publicPlayer : state.profile;
    const background = state.availableBackgrounds.find((item) => item.key === profile?.profile_background);
    const style = document.body.style;
    if (background) style.setProperty("--profile-background-image", `url("${backgroundImageUrl(background)}")`);
    else style.removeProperty("--profile-background-image");
  }

  async function saveProfileBackground(key) {
    if (state.backgroundSaving) return;
    state.backgroundSaving = true;
    try {
      const { profile_background: savedKey } = await api("/api/profile/background", {
        method: "POST",
        body: JSON.stringify({ background_key: key }),
      });
      state.backgroundSaveVersion += 1;
      state.profile.profile_background = savedKey;
      syncAppBackground();
      el("background-selector").querySelectorAll(".background-option").forEach((option) => {
        option.classList.toggle("selected", option.dataset.key === savedKey);
      });
      showNotice(savedKey ? "Фон профиля установлен." : "Фон сброшен.");
    } catch (error) {
      showError(error);
    } finally {
      state.backgroundSaving = false;
    }
  }

  async function renderBackgroundSelector() {
    const backgrounds = await loadBackgrounds();
    syncAppBackground();
    const container = el("background-selector");
    container.replaceChildren();
    el("background-reset").onclick = () => saveProfileBackground(null);
    if (!backgrounds.length) {
      const empty = document.createElement("div");
      empty.className = "hint";
      empty.textContent = "Фоны пока не добавлены.";
      container.append(empty);
      return;
    }
    backgrounds.forEach((bg) => {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "background-option";
      option.dataset.key = bg.key;
      if (bg.vip && !state.profile?.vip.active) {
        option.classList.add("locked");
      }
      if (bg.key === state.profile.profile_background) option.classList.add("selected");
      const img = document.createElement("img");
      img.src = backgroundImageUrl(bg);
      img.alt = bg.title;
      img.loading = "lazy";
      const label = document.createElement("span");
      label.className = "bg-label";
      label.textContent = bg.title;
      if (bg.vip && !state.profile?.vip.active) {
        const tag = document.createElement("span");
        tag.className = "bg-vip-tag";
        tag.textContent = "VIP";
        option.append(tag);
      }
      option.append(img, label);
      option.addEventListener("click", () => {
        if (option.classList.contains("locked")) {
          showNotice("Фон доступен только с активным VIP.");
          return;
        }
        saveProfileBackground(bg.key);
      });
      container.append(option);
    });
  }

  function showProfileTab(name) {
    el("account-own-view").hidden = name !== "mine";
    el("account-gallery-view").hidden = name !== "gallery";
    document.querySelectorAll("[data-profile-tab]").forEach((button) => {
      const active = button.dataset.profileTab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  async function searchPlayers(query) {
    const container = el("player-search-results");
    container.replaceChildren();
    if (query.length < 2) return;
    const result = await api(`/api/players?q=${encodeURIComponent(query)}`);
    if (el("player-search").value.trim() !== query) return;
    if (!result.items.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Игроки не найдены.";
      container.append(empty);
      return;
    }
    result.items.forEach((player) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "player-result";
      const avatar = document.createElement("span");
      avatar.className = "avatar";
      avatar.textContent = player.display_name.trim().slice(0, 1).toUpperCase() || "✦";
      const title = document.createElement("span");
      title.className = "player-result-name";
      const name = document.createElement("strong");
      name.textContent = player.display_name;
      const id = document.createElement("span");
      id.textContent = `ID ${player.id}`;
      title.append(name, id);
      button.append(avatar, title);
      button.addEventListener("click", () =>
        openPublicPlayer(player.id).catch(showError));
      container.append(button);
    });
  }

  function closePlayerProfile() {
    state.publicPlayer = null;
    state.publicInventoryPage = 0;
    state.publicInventoryLoading = false;
    state.publicInventoryIds.clear();
    showPage("account");
    window.scrollTo({ top: 0 });
  }

  async function openPublicPlayer(playerId) {
    const profile = await api(`/api/players/${playerId}`);
    state.publicPlayer = profile;
    el("player-showcases-section").hidden = true;
    api(`/api/players/${playerId}/showcases`).then((data) => {
      if (state.publicPlayer?.id !== playerId) return;
      el("player-showcases").replaceChildren();
      data.items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn btn-secondary btn-block";
        button.textContent = `${item.title} · ${formatCardCount(item.cards.length)} ↗`;
        button.addEventListener("click", () => openShowcase(item.token, "player").catch(showError));
        el("player-showcases").append(button);
      });
      el("player-showcases-section").hidden = !data.items.length;
    }).catch(showError);
    state.publicInventoryPage = 0;
    state.publicInventoryLoading = false;
    state.publicInventoryIds.clear();
    el("player-name").textContent = profile.display_name;
    el("player-id").textContent = `ID ${profile.id}`;
    el("player-avatar").textContent =
      profile.display_name.trim().slice(0, 1).toUpperCase() || "✦";
    el("player-avatar").setAttribute(
      "aria-label", `Аватар: ${profile.display_name}`);
    const vipStatus = el("player-vip");
    vipStatus.textContent = !profile.vip ? ""
      : (profile.vip.active ? "VIP-статус активен" : "VIP-статус не активен");
    vipStatus.hidden = !vipStatus.textContent;
    const stats = el("player-stats");
    stats.replaceChildren();
    [
      ["Собрано карт", profile.card_count],
      ["Легендарных", profile.legendary_count],
      ["Успешных обменов", profile.successful_trades],
    ].forEach(([label, value]) => {
      if (value === null || value === undefined) return;
      const stat = document.createElement("div");
      stat.className = "stat";
      const amount = document.createElement("strong");
      amount.textContent = value;
      const title = document.createElement("span");
      title.textContent = label;
      stat.append(amount, title);
      stats.append(stat);
    });
    el("player-joined").textContent = profile.created_at
      ? `В игре с ${new Date(profile.created_at * 1000).toLocaleDateString("ru-RU")}`
      : "";
    el("player-joined").hidden = !el("player-joined").textContent;
    const favorites = el("player-favorites");
    favorites.replaceChildren();
    if (profile.favorites.length) {
      profile.favorites.forEach((card) =>
        favorites.append(cardButton(card, false, false, null, "")));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Игрок пока не добавил избранные карты.";
      favorites.append(empty);
    }
    const showCollection = Boolean(profile.privacy.show_stats);
    el("player-collection-section").hidden = !showCollection;
    el("player-collection-hidden").hidden = showCollection;
    el("player-cards").replaceChildren();
    el("player-more").hidden = true;
    el("player-more").disabled = false;
    el("player-collection-count").textContent = showCollection
      ? `${profile.card_count} карт` : "";
    showPage("player");
    if (profile.profile_background) {
      loadBackgrounds().then(syncAppBackground);
    }
    window.scrollTo({ top: 0 });
    if (showCollection) await loadPublicInventory(true);
  }

  async function loadPublicInventory(reset = false) {
    if (!state.publicPlayer || state.publicInventoryLoading) return;
    const playerId = state.publicPlayer.id;
    const page = reset ? 1 : state.publicInventoryPage + 1;
    const moreButton = el("player-more");
    state.publicInventoryLoading = true;
    moreButton.disabled = true;
    try {
      const result = await api(
        `/api/players/${playerId}/inventory?page=${page}`);
      if (!state.publicPlayer || state.publicPlayer.id !== playerId) return;
      if (reset) {
        el("player-cards").replaceChildren();
        state.publicInventoryIds.clear();
      }
      result.items.forEach((card) => {
        // Защита от повторов: медленная сеть или повторное нажатие
        // не должны добавлять уже показанную карту второй раз.
        if (state.publicInventoryIds.has(card.id)) return;
        state.publicInventoryIds.add(card.id);
        el("player-cards").append(cardButton(card, false, false, null, ""));
      });
      state.publicInventoryPage = result.page;
      el("player-collection-count").textContent = `${result.total} карт`;
      moreButton.hidden = result.page >= result.pages;
    } finally {
      if (!state.publicPlayer || state.publicPlayer.id === playerId) {
        state.publicInventoryLoading = false;
        moreButton.disabled = false;
      }
    }
  }

  async function saveProfilePrivacy() {
    const settings = {
      is_public: el("privacy-public").checked,
      show_stats: el("privacy-stats").checked,
      show_vip: el("privacy-vip").checked,
      show_joined: el("privacy-joined").checked,
      show_trades: el("privacy-trades").checked,
    };
    const result = await api("/api/profile/privacy", {
      method: "POST",
      body: JSON.stringify(settings),
    });
    state.profile.privacy = result.privacy;
    showNotice("Настройки публичного профиля сохранены.");
  }

  function renderReferrals(data) {
    state.referralLink = data.link;
    el("referral-link").value = data.link;
    el("referral-total").textContent = data.total_invited;
    el("referral-successful").textContent = data.successful_invites;
    el("referral-days").textContent = data.vip_days_earned;
    const history = el("referral-history");
    history.replaceChildren();
    if (!data.history.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Пока никто не зарегистрировался по вашей ссылке.";
      history.append(empty);
      return;
    }
    data.history.forEach((invite) => {
      const row = document.createElement("div");
      row.className = "referral-history-item";
      const name = document.createElement("strong");
      name.textContent = invite.display_name || `Игрок #${invite.invitee_id}`;
      const detail = document.createElement("span");
      detail.className = "hint";
      detail.textContent =
        `${new Date(invite.created_at * 1000).toLocaleDateString("ru-RU")} · +${invite.vip_days} дней VIP`;
      row.append(name, detail);
      history.append(row);
    });
  }

  let vipHistoryLoading = false;

  async function openVipHistory() {
    const dialog = el("vip-history-dialog");
    if (dialog.open) return;
    dialog.showModal();
    syncBackButton();
    if (vipHistoryLoading) return;

    const status = el("vip-history-status");
    el("vip-history").replaceChildren();
    status.textContent = "Загружаем историю…";
    vipHistoryLoading = true;
    try {
      const { items } = await api("/api/vip/history");
      if (dialog.open) {
        renderVipHistory(items);
        status.textContent = items.length ? "" : "Пока нет полученных карт.";
      }
    } catch (error) {
      status.textContent = error.message || "Не удалось загрузить историю.";
    } finally {
      vipHistoryLoading = false;
    }
  }

  function renderVipHistory(items) {
    const container = el("vip-history");
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "vip-history-item";
      const name = document.createElement("strong");
      name.textContent = item.name || `Карта #${item.card}`;
      const detail = document.createElement("span");
      detail.className = "hint";
      detail.textContent =
        `${item.rarity || "Редкость неизвестна"} · ${
          new Date(item.timestamp * 1000).toLocaleString("ru-RU")}`;
      row.append(name, detail);
      container.append(row);
    });
  }

  async function loadFrameShop() {
    await Promise.all([loadFramesCatalog(), loadFrameShopCards(1)]);
    if (!state.frameShopFrameId && state.shopFrames.length) {
      state.frameShopFrameId = state.shopFrames[0].id;
    }
    renderFrameShop();
    renderShopPreview();
  }

  async function loadFrameShopCards(page) {
    const version = ++state.frameShopCardsVersion;
    const data = await api(`/api/inventory?page=${page}&sort=new`);
    if (version !== state.frameShopCardsVersion) return;
    const pinned = state.frameShopPinnedCard;
    state.frameShopCards = pinned && !data.items.some(({ id }) => id === pinned.id)
      ? [pinned, ...data.items] : data.items;
    state.frameShopPage = data.page;
    state.frameShopPages = data.pages;
    if (!state.frameShopCards.some(({ id }) => id === state.frameShopCardId)) {
      state.frameShopCardId = state.frameShopCards[0]?.id ?? null;
    }
    const select = el("frame-shop-card");
    select.replaceChildren();
    state.frameShopCards.forEach((card) => {
      const option = document.createElement("option");
      option.value = String(card.id);
      option.textContent = `${card.name} · #${card.id}`;
      select.append(option);
    });
    select.value = String(state.frameShopCardId ?? "");
    select.disabled = !state.frameShopCards.length;
    el("frame-shop-prev").disabled = data.page <= 1;
    el("frame-shop-next").disabled = data.page >= data.pages;
    el("frame-shop-page").textContent = `${data.page} / ${data.pages}`;
    renderShopPreview();
  }

  async function renderShopPreview() {
    const version = ++state.framePreviewVersion;
    const image = el("frame-shop-image");
    const visual = el("frame-shop-visual");
    visual.replaceChildren(image);
    visual.hidden = true;
    const status = el("frame-shop-preview-status");
    const card = state.frameShopCards.find((item) => item.id === state.frameShopCardId);
    const manage = el("frame-shop-manage");
    manage.disabled = !card || Boolean(card.lock_reason);
    image.hidden = true;
    if (!card || !state.frameShopFrameId) {
      status.textContent = card ? "Выберите рамку для примерки." : "Получите карту, чтобы примерить рамку.";
      return;
    }
    status.textContent = "Загружаем примерку…";
    try {
      const url = await loadCardImageUrl(card, "", state.frameShopFrameId);
      if (version !== state.framePreviewVersion) return;
      image.src = url;
      image.hidden = false;
      visual.hidden = false;
      const frame = state.shopFrames.find((item) => item.id === state.frameShopFrameId);
      const fx = frameEffects(frame?.effect, card.rarity, frame?.rarity, frame?.accent, frame?.ornament_url, frame?.style);
      if (fx) visual.append(fx);
      status.textContent = frame
        ? `Примерка: ${frame.title} · ${frame.id === card.frame_style ? "На этой карте" : frameStockLabel(frame)}`
        : "Примерка рамки";
    } catch (error) {
      if (version === state.framePreviewVersion) status.textContent = "Не удалось загрузить примерку. Выберите рамку ещё раз.";
    }
  }

  function updateCaseButton() {
    const button = el("case-open-button");
    const catalog = state.caseCatalog;
    if (!button || !catalog) return;
    el("case-open-price").textContent = String(catalog.price);
    button.disabled = state.caseOpening || state.crystals < catalog.price;
    el("case-balance-hint").textContent =
      `На балансе: ${state.crystals} кристаллов`;
    renderCaseProgress();
  }

  async function loadCaseCatalog() {
    state.caseCatalog = await api("/api/cases");
    const table = document.createElement("table");
    table.innerHTML = "<thead><tr><th>Награда</th><th>Шанс</th><th>Количество</th></tr></thead>";
    const body = document.createElement("tbody");
    state.caseCatalog.rewards.forEach((reward) => {
      const row = document.createElement("tr");
      for (const value of [
        reward.title, `${reward.chance}%`, String(reward.quantity),
      ]) {
        const cell = document.createElement("td");
        cell.textContent = value;
        row.append(cell);
      }
      body.append(row);
    });
    table.append(body);
    const container = el("case-odds-table");
    container.replaceChildren(table);
    updateCaseButton();
  }

  function caseRewardSummary(result) {
    if (result.reward === "dust") return `Получено ${result.amount} игровой пыли`;
    if (result.reward.startsWith("roll_")) {
      return result.amount === 1
        ? "Получена 1 дополнительная крутка"
        : `Получено дополнительных круток: ${result.amount}`;
    }
    if (result.duplicate) {
      return `Дубликат рамки «${result.frame_title}» · ${result.amount} пыли и 1 осколок`;
    }
    return `Получена рамка «${result.frame_title}»`;
  }

  function waitForCaseReveal() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        document.visibilityState !== "visible") return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        resolve();
      };
      const onVisibilityChange = () => {
        if (document.visibilityState !== "visible") finish();
      };
      document.addEventListener("visibilitychange", onVisibilityChange);
      timer = setTimeout(finish, 1900);
      if (document.visibilityState !== "visible") finish();
    });
  }

  async function openCase() {
    if (state.caseOpening || !state.caseCatalog) return;
    state.caseOpening = true;
    updateCaseButton();
    const price = state.caseCatalog.price;
    const confirmed = await showShopDialog({
      title: "Подтверждение покупки", item: "Премиум-кейс",
      description: "Внутри — пыль, билеты или рамка. Карты из кейса не выпадают.",
      art: "case", price, currency: "crystal",
    });
    if (!confirmed || state.caseCatalog?.price !== price) {
      state.caseOpening = false;
      updateCaseButton();
      if (confirmed) showError(new Error("Цена изменилась. Проверьте её и попробуйте снова."));
      return;
    }
    const overlay = el("case-overlay");
    const close = el("case-close");
    overlay.hidden = false;
    overlay.className = "case-overlay is-loading";
    close.hidden = true;
    el("case-opening-title").textContent = "Готовим кейс…";
    el("case-result").textContent = "Получаем награду…";
    el("case-reward-art").className = "case-reward-art";
    el("case-reward-art").replaceChildren();
    syncBackButton();
    el("case-opening-title").focus();

    let result;
    try {
      result = await api("/api/cases/open", { method: "POST", body: "{}" });
    } catch (error) {
      overlay.hidden = true;
      state.caseOpening = false;
      updateCaseButton();
      syncBackButton();
      showError(error);
      await loadProfile().catch(showError);
      return;
    }

    // The server has already awarded the prize: the visual sequence must never
    // be able to hide the result or postpone updating the displayed balances.
    try {
      setCrystals(result.crystals);
      setBalance(result.dust);
      setRolls(result.rolls);
      state.caseCatalog.progress = result.progress;
      renderCaseProgress();
      const art = result.duplicate || result.reward === "dust"
        ? "dust" : result.reward?.startsWith("roll_") ? "ticket" : "frame";
      el("case-reward-art").className = `case-reward-art case-reward-art--${art}`;
      if (art === "frame" && result.frame_preview_url) {
        const thumbnail = document.createElement("img");
        thumbnail.src = frameAssetUrl(result.frame_preview_url);
        thumbnail.alt = result.frame_title;
        el("case-reward-art").append(thumbnail);
        const fx = frameEffects(result.frame_effect, result.frame_rarity, result.frame_rarity,
          result.frame_accent, result.frame_ornament_url, result.frame_theme);
        if (fx) el("case-reward-art").append(fx);
      }
      el("case-opening-title").textContent = "Открываем кейс…";
      el("case-result").textContent = "Награда уже близко";
      overlay.className = "case-overlay is-opening";
      await waitForCaseReveal();
    } catch (_error) {
      // Keep the awarded result visible even if a visual update fails.
      loadProfile().catch(showError);
    } finally {
      overlay.className = "case-overlay is-revealed";
      el("case-opening-title").textContent = "Награда получена!";
      try {
        el("case-result").textContent = caseRewardSummary(result);
      } catch (_error) {
        el("case-result").textContent = "Награда начислена. Проверьте баланс и коллекцию.";
      }
      close.hidden = false;
      state.caseOpening = false;
      updateCaseButton();
      close.focus();
      haptic("success");
    }
  }

  function closeCaseOpening() {
    if (state.caseOpening) return;
    el("case-overlay").hidden = true;
    el("case-overlay").className = "case-overlay";
    syncBackButton();
  }

  function framePackItem(frame, chance) {
    const item = document.createElement("article");
    item.className = "frame-item";
    item.dataset.rarity = frame.rarity;
    item.classList.toggle("is-previewed", frame.id === state.frameShopFrameId);
    const image = document.createElement("img");
    image.className = "frame-preview";
    image.src = frameAssetUrl(frame.preview_url);
    image.alt = frame.title;
    image.loading = "lazy";
    const info = document.createElement("div");
    info.className = "frame-item-info";
    const title = document.createElement("strong");
    title.textContent = frame.title;
    const meta = document.createElement("span");
    meta.className = "hint";
    meta.textContent = [frame.rarity_title, chance === undefined ? "Из премиум-кейса" : `Шанс ${chance}%`,
      frameStockLabel(frame)].join(" · ");
    info.append(title, meta);
    const actions = document.createElement("div");
    actions.className = "frame-item-actions";
    const tryOn = document.createElement("button");
    tryOn.type = "button";
    tryOn.className = "btn btn-secondary";
    tryOn.textContent = "Примерить";
    tryOn.setAttribute("aria-pressed", String(frame.id === state.frameShopFrameId));
    tryOn.addEventListener("click", async () => {
      state.frameShopFrameId = frame.id;
      document.querySelectorAll(".frame-item.is-previewed").forEach((node) => node.classList.remove("is-previewed"));
      document.querySelectorAll(".frame-item button[aria-pressed]").forEach((node) => node.setAttribute("aria-pressed", "false"));
      item.classList.add("is-previewed");
      tryOn.setAttribute("aria-pressed", "true");
      await renderShopPreview();
      const target = el("frame-shop-visual").hidden ? el("frame-shop-preview") : el("frame-shop-visual");
      target.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    });
    actions.append(tryOn);
    item.append(image, info, actions);
    return item;
  }

  function renderFrameShop() {
    const container = el("frame-shop");
    container.replaceChildren();
    el("frame-shop-balance").textContent = `${state.balance} пыли · ${state.crystals} кристаллов`;
    el("frame-shop-preview").hidden = !state.shopFrames.length;
    state.framePacks.forEach((pack) => {
      const section = document.createElement("section");
      section.className = "frame-pack";
      const cover = document.createElement("img");
      cover.className = "frame-pack-cover";
      cover.src = frameAssetUrl(pack.cover_url);
      cover.alt = `Пак «${pack.title}»`;
      cover.loading = "lazy";
      const heading = document.createElement("h3");
      heading.textContent = pack.title;
      const description = document.createElement("p");
      description.className = "hint";
      description.textContent = `Одна случайная рамка за открытие. Собрано ${pack.items.filter((item) => item.owned).length} / ${pack.items.length}. Дубликат → ${pack.duplicate_dust} пыли.`;
      const actions = document.createElement("div");
      actions.className = "frame-pack-actions";
      [["dust", pack.dust_price, "пыли"], ["crystals", pack.crystal_price, "кристаллов"]].forEach(([currency, price, label]) => {
        const buy = document.createElement("button");
        buy.type = "button";
        buy.className = `btn btn-${currency === "dust" ? "secondary" : "primary"} frame-pack-open`;
        buy.textContent = `Открыть · ${price} ${label}`;
        buy.disabled = state.packOpening || (currency === "dust" ? state.balance : state.crystals) < price;
        buy.addEventListener("click", () => openFramePack(pack, currency));
        actions.append(buy);
      });
      const contents = document.createElement("details");
      contents.className = "frame-pack-contents";
      const summary = document.createElement("summary");
      summary.textContent = `Содержимое и шансы · ${pack.items.map((frame) => `${frame.chance}%`).join(" / ")}`;
      const grid = document.createElement("div");
      grid.className = "frame-pack-items";
      pack.items.forEach((frame) => grid.append(framePackItem(frame, frame.chance)));
      contents.append(summary, grid);
      section.append(cover, heading, description, actions, contents);
      container.append(section);
    });
    const exclusives = document.createElement("details");
    exclusives.className = "frame-pack frame-pack-contents";
    const summary = document.createElement("summary");
    summary.textContent = "Эксклюзивы премиум-кейса · с эффектами";
    const grid = document.createElement("div");
    grid.className = "frame-pack-items";
    state.shopFrames.filter((frame) => frame.case_only).forEach((frame) => grid.append(framePackItem(frame)));
    exclusives.append(summary, grid);
    container.append(exclusives);
  }

  async function animateFrameRoulette(pack, result) {
    const track = el("frame-roulette-track");
    track.replaceChildren();
    const winnerIndex = 24;
    for (let index = 0; index < 30; index += 1) {
      const frame = index === winnerIndex ? result.frame : pack.items[index % pack.items.length];
      const tile = document.createElement("div");
      tile.className = "frame-roulette-tile";
      const image = document.createElement("img");
      image.src = frameAssetUrl(frame.preview_url);
      image.alt = "";
      const name = document.createElement("span");
      name.textContent = frame.title;
      tile.append(image, name);
      track.append(tile);
    }
    const tileWidth = track.firstElementChild.getBoundingClientRect().width;
    const offset = winnerIndex * (tileWidth + 12) - (el("frame-roulette-window").clientWidth - tileWidth) / 2;
    const end = `translateX(${-offset}px)`;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || document.hidden || !track.animate) {
      track.style.transform = end;
      return;
    }
    const animation = track.animate([{ transform: "translateX(0)" }, { transform: end }],
      { duration: 3400, easing: "cubic-bezier(.12,.65,.12,1)", fill: "forwards" });
    const finish = () => { if (document.hidden || reduced.matches) animation.finish(); };
    document.addEventListener("visibilitychange", finish);
    reduced.addEventListener("change", finish);
    try { await animation.finished; }
    finally {
      track.style.transform = end;
      animation.cancel();
      document.removeEventListener("visibilitychange", finish);
      reduced.removeEventListener("change", finish);
    }
  }

  async function openFramePack(pack, currency) {
    if (state.packOpening) return;
    state.packOpening = true;
    renderFrameShop();
    const price = currency === "dust" ? pack.dust_price : pack.crystal_price;
    try {
      if (!await showShopDialog({ title: "Открыть пак рамок", item: pack.title,
        description: `Выпадет одна рамка. Шансы: ${pack.items.map((frame) => `${frame.title} — ${frame.chance}%`).join(", ")}. Дубликат: ${pack.duplicate_dust} пыли.`,
        art: "frame", price, currency: currency === "dust" ? "dust" : "crystal" })) return;
      const overlay = el("frame-roulette");
      overlay.hidden = false;
      el("frame-roulette-title").textContent = pack.title;
      el("frame-roulette-result").textContent = "Открываем пак…";
      el("frame-roulette-close").hidden = true;
      el("frame-roulette-track").replaceChildren();
      el("frame-roulette-track").style.transform = "none";
      el("frame-roulette-award").replaceChildren();
      syncBackButton();
      el("frame-roulette-title").focus();
      let result;
      try {
        result = await api("/api/frames/packs/open", { method: "POST", body: JSON.stringify({ pack_id: pack.id, currency }) });
      } catch (error) {
        overlay.hidden = true;
        syncBackButton();
        throw error;
      }
      // Persisted reward is authoritative. A visual failure must still reveal it.
      const replace = (frame) => frame.id === result.frame.id ? result.frame : frame;
      state.shopFrames = state.shopFrames.map(replace);
      state.framePacks = state.framePacks.map((entry) => ({ ...entry,
        items: entry.items.map((frame) => ({ ...replace(frame), chance: frame.chance })) }));
      setBalance(result.balance);
      setCrystals(result.crystals);
      try { await animateFrameRoulette(pack, result); }
      catch (_error) { /* Reveal the server result even if motion is unavailable. */ }
      finally {
        const award = document.createElement("img");
        award.src = frameAssetUrl(result.frame.live_preview_url || result.frame.preview_url);
        award.alt = result.frame.title;
        el("frame-roulette-award").append(award);
        const fx = frameEffects(result.frame.effect, result.frame.rarity, result.frame.rarity,
          result.frame.accent, result.frame.ornament_url, result.frame.style);
        if (fx) el("frame-roulette-award").append(fx);
        el("frame-roulette-result").textContent = result.duplicate
          ? `Дубликат «${result.frame.title}» → ${result.compensation_dust} пыли.`
          : `Получена рамка «${result.frame.title}»!`;
        el("frame-roulette-close").hidden = false;
        el("frame-roulette-close").focus();
        haptic("success");
      }
    } catch (error) { showError(error); }
    finally { state.packOpening = false; renderFrameShop(); }
  }

  function closeFrameRoulette() {
    if (state.packOpening) return;
    el("frame-roulette").hidden = true;
    el("frame-roulette-track").replaceChildren();
    el("frame-roulette-award").replaceChildren();
    syncBackButton();
  }

  el("frame-roulette-close").addEventListener("click", closeFrameRoulette);
  el("frame-shop-card").addEventListener("change", (event) => {
    state.frameShopCardId = Number(event.target.value);
    renderShopPreview();
  });
  el("frame-shop-prev").addEventListener("click", () => loadFrameShopCards(state.frameShopPage - 1).catch(showError));
  el("frame-shop-next").addEventListener("click", () => loadFrameShopCards(state.frameShopPage + 1).catch(showError));
  el("frame-shop-manage").addEventListener("click", () => {
    const card = state.frameShopCards.find((item) => item.id === state.frameShopCardId);
    if (!card || card.lock_reason) return;
    openFramePicker(card, {
      frameId: state.frameShopFrameId,
      onBack: () => {
        closeSheet();
        loadFramesCatalog().then(() => {
          renderFrameShop();
          renderShopPreview();
        }).catch(showError);
      },
    });
  });

  async function equipFrame(card, frame) {
    const result = await api(`/api/cards/${card.id}/frame`, {
      method: "POST", body: JSON.stringify({ frame_id: frame.id }),
    });
    applyCardUpdate(result.card);
    if (state.activePage === "collection" && state.collectionMode === "cards") {
      if (!state.collectionLoading) renderCollection();
      renderReceivedCards();
    }
    if (state.activePage === "account") renderFavorites();
    renderHome();
    showNotice(frame.id === "classic" ? "Рамка снята и возвращена в инвентарь."
      : `Рамка «${frame.title}» надета на «${result.card.name}».`);
    haptic("success");
    return result.card;
  }

  function updateAuctionCountdowns() {
    document.querySelectorAll("[data-auction-expiry]").forEach((element) => {
      const seconds = Math.max(
        0, Number(element.dataset.auctionExpiry) - Math.floor(Date.now() / 1000));
      element.textContent = seconds === 0 ? "Завершение…" : formatDuration(seconds);
      element.classList.toggle("is-urgent", seconds > 0 && seconds <= 120);
      if (seconds === 0) {
        element.closest(".listing")?.querySelector("button")?.setAttribute("disabled", "true");
      }
    });
  }
  window.setInterval(updateAuctionCountdowns, 1000);

  function render() {
    const ownOffer = state.trade?.viewer_is_sender;
    const left = ownOffer
      ? state.trade.sender_cards
      : state.trade?.status === "accepted"
        ? state.trade.recipient_cards : selectedCards();
    const right = state.trade
      ? ownOffer ? state.trade.recipient_cards : state.trade.sender_cards
      : [];
    el("left-count").textContent = `${left.length} карт`;
    el("right-count").textContent = `${right.length} карт`;
    el("left-cards").replaceChildren();
    el("right-cards").replaceChildren();
    if (!left.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Выберите карты из инвентаря ниже";
      el("left-cards").append(empty);
    } else {
      left.forEach((card) => el("left-cards").append(cardButton(card, true, true, () => {})));
    }
    if (!right.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = state.trade ? "Встречные карты не выбраны" : "Получатель добавит свои карты";
      el("right-cards").append(empty);
    } else {
      right.forEach((card) => el("right-cards").append(cardButton(card, false, true, () => {})));
    }
    const isReceiver = state.trade && !ownOffer;
    el("left-title").textContent = ownOffer ? "Вы предложили" : "Вы отдаёте";
    el("right-title").textContent = ownOffer ? "Получатель предложил" : "Вы получаете";
    el("trade-title").textContent = state.trade
      ? ownOffer ? "Ваше предложение обмена" : `Обмен от ${state.trade.sender_name || "игрока"}`
      : "Новое предложение";
    el("trade-state").textContent = state.trade
      ? state.trade.status === "pending" ? "Ожидает подтверждения" : "Обмен завершён"
      : "Выберите карты для обмена";
    el("trade-step-1").classList.toggle("on", !state.link && !state.trade);
    el("trade-step-2").classList.toggle("on", Boolean(state.link || ownOffer));
    el("trade-step-3").classList.toggle("on", Boolean(isReceiver || state.trade?.status === "accepted"));
    const inventorySection = el("inventory-section");
    inventorySection.hidden = Boolean(ownOffer || state.trade?.status !== "pending" && state.trade);
    el("inventory-title").textContent = isReceiver
      ? "Ваш инвентарь · добавьте встречные карты"
      : "Ваш инвентарь · выберите карты";
    const inventoryCards = state.inventory.filter((card) =>
      card.name.toLowerCase().includes(state.query) ||
      card.series.toLowerCase().includes(state.query));
    el("inventory-cards").replaceChildren();
    if (!inventoryCards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.gridColumn = "1 / -1";
      empty.textContent = state.inventory.length ? "По запросу ничего не найдено" : "В инвентаре нет карт";
      el("inventory-cards").append(empty);
    } else {
      inventoryCards.forEach((card) => {
        const selected = state.selected.has(card.id);
        el("inventory-cards").append(cardButton(
          card, selected, Boolean(card.lock_reason) || (!selected && state.selected.size >= 10),
          () => {
            if (state.selected.has(card.id)) state.selected.delete(card.id);
            else state.selected.set(card.id, card);
            render();
          }));
      });
    }
    el("page-label").textContent = `${state.page} / ${state.pages}`;
    el("prev").disabled = state.page <= 1;
    el("next").disabled = state.page >= state.pages;
    const primary = el("primary");
    const cancel = el("cancel");
    const selectedCount = state.selected.size;
    const readyToCreate = !state.trade && selectedCount > 0;
    const readyToAccept = isReceiver && state.trade.status === "pending" && selectedCount > 0;
    primary.textContent = isReceiver ? "Принять обмен" : "Создать ссылку обмена";
    primary.disabled = state.tradeSubmitting || !(readyToCreate || readyToAccept);
    primary.hidden = Boolean(ownOffer || state.trade?.status !== "pending" && state.trade);
    cancel.hidden = !ownOffer || state.trade.status !== "pending";
    if (state.trade?.status === "accepted") {
      primary.hidden = true;
      el("hint").textContent = "Карты успешно обменены.";
    } else if (state.trade?.status === "cancelled" || state.trade?.status === "expired") {
      primary.hidden = true;
      el("hint").textContent = "Это предложение больше не действует.";
    } else {
      el("hint").textContent = state.trade
        ? "Выберите свои карты и подтвердите обмен. Обмен необратим."
        : "До 10 карт с каждой стороны. Предложенные карты блокируются до ответа.";
    }
    el("share").classList.toggle("is-open", Boolean(state.link));
    el("share").style.display = state.link ? "block" : "none";
  }

  async function loadInventory(page = 1) {
    const data = await api(`/api/inventory?page=${page}`);
    state.inventory = data.items;
    state.page = data.page;
    state.pages = data.pages;
    setBalance(data.balance);
    render();
  }
  async function loadTrade() {
    const info = await api(`/api/trades/${encodeURIComponent(state.tradeToken)}`);
    state.trade = info;
    if (info.status === "pending" && !info.viewer_is_sender) await loadInventory(1);
    else render();
  }
  async function createOffer(cards) {
    const data = await api("/api/trades", {
      method: "POST",
      body: JSON.stringify({ card_ids: cards.map((card) => card.id) }),
    });
    state.tradeToken = data.token;
    state.link = data.link;
    state.trade = data.trade;
    await navigator.clipboard?.writeText(data.link).catch(() => {});
    render();
    el("share-link").value = data.link;
  }
  async function acceptOffer(token, cards) {
    await api(`/api/trades/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify({ card_ids: cards.map((card) => card.id) }),
    });
    state.selected.clear();
    await loadTrade();
    haptic("success");
  }

  async function claimDailyReward() {
    el("daily-button").disabled = true;
    try {
      const result = await api("/api/daily-reward", { method: "POST", body: "{}" });
      setBalance(result.balance);
      if (state.profile) state.profile.daily_reward_available = false;
      el("daily-status").textContent = "Награда уже получена. После полуночи по Москве.";
      el("daily-button").textContent = "Получено";
      showNotice(`Получена ежедневная награда: +${result.amount} пыли.`);
      haptic("success");
    } catch (error) {
      showError(error);
      el("daily-button").disabled = false;
    }
  }
  async function purchaseRolls(button) {
    if (state.ticketPurchaseInProgress) return;
    const amount = Number(button.dataset.buyRolls);
    if (!Number.isSafeInteger(amount) || amount < 1) return;
    const price = amount * state.rollCrystalCost;
    state.ticketPurchaseInProgress = true;
    updateRollShopButtons();
    try {
      const confirmed = await showShopDialog({
        title: "Подтверждение покупки", item: `${amount} ${ticketWord(amount)}`,
        description: "Билеты можно использовать для открытия карт.",
        art: "ticket", price, currency: "crystal",
      });
      if (!confirmed) return;
      if (price !== amount * state.rollCrystalCost) {
        throw new Error("Цена изменилась. Проверьте её и попробуйте снова.");
      }
      const result = await api("/api/rolls/buy", {
        method: "POST", body: JSON.stringify({ amount }),
      });
      setCrystals(result.crystals);
      setRolls(result.rolls);
      haptic("success");
      await showShopDialog({
        title: "Покупка успешна!", item: `${result.amount} ${ticketWord(result.amount)}`,
        description: `Билеты добавлены на ваш счёт. Списано ${result.crystal_cost} кристаллов.`,
        art: "success", success: true,
      });
    } catch (error) { showError(error); }
    finally {
      state.ticketPurchaseInProgress = false;
      updateRollShopButtons();
    }
  }
  function removeDustedCards(result) {
    const removed = new Set(result.card_ids);
    state.receivedCards = state.receivedCards.filter((card) => !removed.has(card.id));
    state.homeCards = state.homeCards.filter((card) => !removed.has(card.id));
    state.favorites = state.favorites.filter((card) => !removed.has(card.id));
    if (removed.has(state.frameShopPinnedCard?.id)) state.frameShopPinnedCard = null;
    clearCollectionSelection();
    state.ownedCardCount = Math.max(0, state.ownedCardCount - removed.size);
    el("card-count").textContent = state.ownedCardCount;
    setBalance(result.balance);
  }

  async function dustSelected(alreadyConfirmed = false) {
    const cards = [...state.collectionSelected.values()];
    if (!cards.length) return;
    const favorites = cards.filter((card) => state.favorites.some((item) => item.id === card.id));
    if (cards.length > 1 && favorites.length) {
      showError(new Error("Избранные карты защищены от массового распыления. Уберите их из выбора."));
      return;
    }
    const value = cards.reduce((sum, card) => sum + card.dust_value, 0);
    const warning = (favorites.length ? " Карта в избранном!" : cards.some((card) => ["legendary", "mythical"].includes(card.rarity)) ? " Среди карт есть легендарные или мифические!" : "") +
      (cards.some((card) => card.upgrade_level > 0) ? " Оплаченное оформление исчезнет без возврата пыли!" : "");
    if (!alreadyConfirmed && !await confirmAction(
      `Распылить карт: ${cards.length}, за ${value} пыли?${warning} Это действие нельзя отменить.`)) return;
    try {
      const result = await api("/api/dust", {
        method: "POST",
        body: JSON.stringify({ card_ids: cards.map((card) => card.id) }),
      });
      removeDustedCards(result);
      if (state.activePage === "collection") refreshCollection();
      if (state.activePage === "home") renderHome();
      showNotice(`Распылено карт: ${result.card_ids.length}. Получено ${result.amount} пыли.`);
      haptic("success");
    } catch (error) { showError(error); }
  }
  async function transferSelected() {
    const cards = [...state.collectionSelected.values()];
    if (!cards.length || state.transferSubmitting) return;
    state.transferSubmitting = true;
    try {
      if (!await confirmAction(`Создать ссылку передачи: ${formatCardCount(cards.length)}? ${frameHandoffWarning(cards)}`)) return;
      const result = await api("/api/transfers", {
        method: "POST",
        body: JSON.stringify({ card_ids: cards.map((card) => card.id) }),
      });
      state.transferLink = result.link;
      el("transfer-link").value = result.link;
      state.collectionSelected.clear();
      state.selectMode = false;
      renderCollectionSelection();
      if (state.activePage === "collection") refreshCollection();
      showNotice("Ссылка передачи создана и действует 24 часа.");
      const body = document.createElement("div");
      const input = document.createElement("input");
      input.className = "field";
      input.readOnly = true;
      input.value = result.link;
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn btn-secondary btn-block";
      copy.textContent = "Копировать";
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(result.link).catch(() => input.select());
      });
      const send = document.createElement("button");
      send.type = "button";
      send.className = "btn btn-primary btn-block";
      send.textContent = "Отправить";
      send.addEventListener("click", () => {
        const text = encodeURIComponent("Передаю тебе карты!");
        if (tg?.openTelegramLink) {
          tg.openTelegramLink(
            `https://t.me/share/url?url=${encodeURIComponent(result.link)}&text=${text}`);
        } else window.open(result.link, "_blank", "noopener");
      });
      body.append(input, copy, send);
      openSheet("Ссылка передачи", body);
    } catch (error) { showError(error); }
    finally { state.transferSubmitting = false; }
  }
  async function sellSelected() {
    const cards = [...state.collectionSelected.values()];
    if (cards.length !== 1 || state.listingSubmitting) return;
    const card = cards[0];
    const price = Number(el("auction-start-price").value);
    if (!Number.isSafeInteger(price) || price <= 0) {
      showError(new Error("Укажите стартовую ставку — целое число больше нуля."));
      return;
    }
    state.listingSubmitting = true;
    try {
      if (!await confirmAction(`Выставить карту на аукцион? ${frameHandoffWarning(cards)}`)) return;
      await api("/api/listings", {
        method: "POST",
        body: JSON.stringify({ card_id: card.id, starting_price: price }),
      });
      state.collectionSelected.clear();
      state.selectMode = false;
      renderCollectionSelection();
      if (state.activePage === "collection") refreshCollection();
      showNotice(`Аукцион создан со стартовой ставкой ${price} пыли на 24 часа.`);
      haptic("success");
    } catch (error) { showError(error); }
    finally { state.listingSubmitting = false; }
  }

  el("drop-close").addEventListener("click", closeDropOpening);
  el("drop-skip").addEventListener("click", () => {
    if (!dropSession) return;
    dropSession.skipped = true;
    dropSession.wake?.();
    el("drop-skip").hidden = true;
    el("drop-description").textContent = "Ожидаем ответ сервера…";
  });
  el("drop-dust").addEventListener("click", async () => {
    if (!state.lastDropCard) return;
    const card = state.lastDropCard;
    if (!await confirmAction(
      `Распылить карту «${card.name}» за ${card.dust_value} пыли? Это действие нельзя отменить.`)) return;
    closeDropOpening();
    state.collectionSelected = new Map([[card.id, card]]);
    await dustSelected(true);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el("vip-history-dialog").open) {
      if (!el("shop-dialog").hidden) closeShopDialog(false);
      else if (!el("info-popup").hidden) closeInfoPopup();
      else if (!el("frame-roulette").hidden) closeFrameRoulette();
      else if (!el("case-overlay").hidden) closeCaseOpening();
      else if (!el("drop-overlay").hidden) closeDropOpening();
      else if (!el("sheet").hidden) closeSheet();
    }
  });
  el("vip-history-open").addEventListener("click", openVipHistory);
  el("vip-history-dialog").addEventListener("close", syncBackButton);
  el("vip-history-dialog").addEventListener("click", (event) => {
    const dialog = event.currentTarget;
    if (event.target !== dialog) return;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) {
      dialog.close();
    }
  });
  el("shop-dialog-close").addEventListener("click", () => closeShopDialog(false));
  el("shop-dialog-backdrop").addEventListener("click", () => closeShopDialog(false));
  el("shop-dialog-cancel").addEventListener("click", () => closeShopDialog(false));
  el("shop-dialog-confirm").addEventListener("click", () => closeShopDialog(true));
  el("shop-dialog").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...el("shop-dialog").querySelectorAll("button:not([hidden]):not(:disabled)")];
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  el("sheet-close").addEventListener("click", closeSheet);
  el("sheet-backdrop").addEventListener("click", closeSheet);

  document.querySelectorAll(".info-trigger").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openInfoPopup(button.dataset.infoTitle || "", button.dataset.infoText || "");
    });
  });
  el("info-popup-close").addEventListener("click", closeInfoPopup);
  el("info-popup-backdrop").addEventListener("click", closeInfoPopup);
  el("primary").addEventListener("click", async () => {
    const cards = selectedCards();
    if (!cards.length || state.tradeSubmitting) return;
    const trade = state.trade;
    const token = state.tradeToken;
    const warning = frameHandoffWarning(trade ? [...cards, ...trade.sender_cards] : cards);
    state.tradeSubmitting = true;
    el("primary").disabled = true;
    try {
      if (!await confirmAction(`${trade ? "Принять обмен? Обмен необратим." : "Создать ссылку обмена?"} ${warning}`)) return;
      if (trade) await acceptOffer(token, cards);
      else await createOffer(cards);
    } catch (error) { showError(error); }
    finally { state.tradeSubmitting = false; render(); }
  });
  el("cancel").addEventListener("click", async () => {
    try {
      await api(`/api/trades/${encodeURIComponent(state.tradeToken)}/cancel`, {
        method: "POST", body: "{}",
      });
      state.trade.status = "cancelled";
      render();
    } catch (error) { showError(error); }
  });
  el("prev").addEventListener("click", () => loadInventory(state.page - 1).catch(showError));
  el("next").addEventListener("click", () => loadInventory(state.page + 1).catch(showError));
  el("search").addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    render();
  });
  el("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.link);
      el("copy").textContent = "Скопировано";
      setTimeout(() => { el("copy").textContent = "Копировать"; }, 1600);
    } catch { el("share-link").select(); }
  });
  el("send").addEventListener("click", () => {
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(state.link)}&text=${encodeURIComponent("Предлагаю обмен картами!")}`);
    } else window.open(state.link, "_blank", "noopener");
  });
  document.querySelectorAll(".main-nav button").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.page));
  });
  document.querySelectorAll("[data-profile-tab]").forEach((button) => {
    button.addEventListener("click", () => showProfileTab(button.dataset.profileTab));
  });
  el("privacy-save").addEventListener("click", () =>
    saveProfilePrivacy().catch(showError));
  el("player-search").addEventListener("input", (event) => {
    clearTimeout(state.playerSearchTimer);
    const query = event.target.value.trim();
    state.playerSearchTimer = setTimeout(
      () => searchPlayers(query).catch(showError), 250);
  });
  el("player-page-back").addEventListener("click", closePlayerProfile);
  el("player-more").addEventListener("click", () =>
    loadPublicInventory().catch(showError));
  document.querySelectorAll("[data-open-page]").forEach((button) => {
    button.addEventListener("click", () => showPage(button.dataset.openPage));
  });
  document.querySelectorAll("[data-market-tab]").forEach((button) => {
    button.addEventListener("click", () => setMarketTab(button.dataset.marketTab));
  });
  document.querySelectorAll("[data-shop-tab]").forEach((button) => {
    button.addEventListener("click", () => setShopTab(button.dataset.shopTab));
  });
  el("ticket-drop-button").addEventListener("click", openExtraRoll);
  el("drop-all-button").addEventListener("click", () => openDrop(true));
  el("drop-button").addEventListener("click", () => openDrop());
  el("drop-retry").addEventListener("click", () => {
    el("drop-retry").hidden = true;
    el("drop-timer").textContent = "Обновляем запас…";
    loadProfile().catch(showDropLoadError);
  });
  el("case-open-button").addEventListener("click", openCase);
  el("case-close").addEventListener("click", closeCaseOpening);
  document.querySelectorAll("[data-buy-rolls]").forEach((button) => {
    button.addEventListener("click", () => purchaseRolls(button));
  });
  el("ticket-amount").addEventListener("input", updateRollShopButtons);
  el("daily-button").addEventListener("click", claimDailyReward);
  el("referral-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.referralLink);
      showNotice("Реферальная ссылка скопирована.");
    } catch {
      el("referral-link").select();
      showNotice("Ссылка выделена — скопируйте её вручную.");
    }
  });
  el("referral-share").addEventListener("click", () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(state.referralLink)}&text=${
      encodeURIComponent("Присоединяйся к игре по моей ссылке!")}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url);
    else window.open(url, "_blank", "noopener");
  });
  el("collection-search").addEventListener("input", (event) => {
    state.collectionQuery = event.target.value.trim();
    clearCollectionSelection();
    updateCollectionReset();
    clearTimeout(state.collectionSearchTimer);
    state.collectionSearchTimer = setTimeout(
      reloadCatalog, 250);
  });
  document.querySelectorAll("[data-collection-mode]").forEach((button) => {
    button.addEventListener("click", () => setCollectionMode(button.dataset.collectionMode));
  });
  el("collection-received-close").addEventListener("click", () => {
    state.receivedCards = [];
    renderReceivedCards();
  });
  el("collection-reset").addEventListener("click", () => {
    state.collectionQuery = state.collectionRarity = state.collectionFilter = "";
    state.collectionSort = "new";
    el("collection-search").value = "";
    clearCollectionSelection();
    renderCollectionFilters();
    el("collection-search").focus();
    reloadCatalog();
  });
  el("collection-favorites").addEventListener("click", () => {
    state.collectionFilter = "favorites";
    state.collectionRarity = state.collectionQuery = "";
    el("collection-search").value = "";
    setCollectionMode("cards");
  });
  el("collection-album-back").addEventListener("click", () => {
    albums.series = null;
    loadCollectionAlbums(albums.listPage).catch(showError);
  });
  el("collection-album-prev").addEventListener("click", () => loadCollectionAlbums(albums.page - 1).catch(showError));
  el("collection-album-next").addEventListener("click", () => loadCollectionAlbums(albums.page + 1).catch(showError));
  el("collection-copy-prev").addEventListener("click", () => loadCollectionCopies(copies.page - 1).catch(showError));
  el("collection-copy-next").addEventListener("click", () => loadCollectionCopies(copies.page + 1).catch(showError));
  el("collection-copy-review").addEventListener("click", reviewCollectionCopies);
  el("collection-select").addEventListener("click", () => {
    state.selectMode = true;
    renderCollectionSelection();
    showToast("Нажмите на карты, чтобы выбрать до 10.");
  });
  el("select-cancel").addEventListener("click", () => {
    clearCollectionSelection();
    renderCollection();
  });
  el("collection-more").addEventListener("click", () =>
    loadCollection(state.collectionPage + 1).catch(showError));
  el("frame-shop-to-collection").addEventListener("click", () => {
    state.collectionMode = "cards";
    showPage("collection");
    haptic("light");
  });
  el("dust-selected").addEventListener("click", () => dustSelected());
  el("transfer-selected").addEventListener("click", transferSelected);
  el("sell-selected").addEventListener("click", sellSelected);
  el("create-lot").addEventListener("click", () => {
    state.collectionMode = "cards";
    clearCollectionSelection();
    state.selectMode = true;
    showPage("collection");
    showToast("Выберите одну карту, затем «Продать».");
  });
  document.querySelectorAll("[data-select-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.selectAction;
      if (action === "dust") dustSelected();
      if (action === "transfer") transferSelected();
      if (action === "sell") {
        const cards = [...state.collectionSelected.values()];
        if (cards.length === 1) openSellSheet(cards[0]);
        else showError(new Error("Для продажи выберите одну карту."));
      }
    });
  });
  el("transfer-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(state.transferLink);
    } catch { el("transfer-link").select(); }
  });
  el("transfer-send").addEventListener("click", () => {
    const text = encodeURIComponent("Передаю тебе карты!");
    if (tg?.openTelegramLink) {
      tg.openTelegramLink(
        `https://t.me/share/url?url=${encodeURIComponent(state.transferLink)}&text=${text}`);
    } else window.open(state.transferLink, "_blank", "noopener");
  });

  const sentinel = el("collection-sentinel");
  if ("IntersectionObserver" in window) {
    new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (state.activePage !== "collection" || state.collectionMode !== "cards") return;
      if (state.collectionPage >= state.collectionPages) return;
      loadCollection(state.collectionPage + 1).catch(showError);
    }, { rootMargin: "240px" }).observe(sentinel);
  }

  try {
    tg?.BackButton?.onClick?.(() => {
      if (el("vip-history-dialog").open) el("vip-history-dialog").close();
      else if (!el("shop-dialog").hidden) closeShopDialog(false);
      else if (!el("info-popup").hidden) closeInfoPopup();
      else if (!el("frame-roulette").hidden) closeFrameRoulette();
      else if (!el("case-overlay").hidden) closeCaseOpening();
      else if (!el("drop-overlay").hidden) closeDropOpening();
      else if (!el("sheet").hidden) closeSheet();
      else if (state.activePage === "player") closePlayerProfile();
      else if (state.activePage === "showcases") backFromShowcases();
    });
  } catch (_error) { /* browser preview */ }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getInitData()) {
      loadProfile().catch(showDropLoadError);
    }
  });

  const displayState = { items: [], draft: null, viewed: null, mode: "manager", returnPage: "account", managerReturnPage: "account",
    pickerItems: [], pickerPage: 1, pickerPages: 1, pickerVersion: 0, busy: false };
  const displayThemes = { lunar: "Лунный сад", neon: "Неоновая ночь", gold: "Золотая галерея" };

  function displayButton(text, action, secondary = true) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `btn ${secondary ? "btn-secondary" : "btn-primary"}`;
    button.textContent = text;
    button.addEventListener("click", () => Promise.resolve().then(action).catch(showError));
    return button;
  }

  function renderDisplay(item, editing = false) {
    const article = document.createElement("article");
    article.className = "showcase-art";
    article.dataset.theme = item.theme;
    const header = document.createElement("header");
    const kicker = document.createElement("span");
    kicker.className = "showcase-kicker";
    kicker.textContent = "CHIZU · CURATED COLLECTION";
    const title = document.createElement("h2");
    title.textContent = item.title || "Моя витрина";
    const subtitle = document.createElement("span");
    subtitle.className = "showcase-subtitle";
    subtitle.textContent = `${displayThemes[item.theme]} · ${formatCardCount(item.cards.length)}`;
    header.append(kicker, title, subtitle);
    article.append(header);
    const grid = document.createElement("div");
    grid.className = "showcase-grid";
    item.cards.forEach((card, index) => {
      const slot = document.createElement("div");
      slot.className = "showcase-slot";
      const tile = cardButton(card, false, false, null, "");
      tile.tabIndex = -1;
      slot.append(tile);
      if (editing) {
        const controls = document.createElement("div");
        controls.className = "showcase-slot-controls";
        [-1, 1, 0].forEach((direction) => {
          const button = displayButton(direction === 0 ? "×" : direction < 0 ? "←" : "→", () => {
            if (displayState.busy) return;
            const cards = displayState.draft.cards;
            if (!direction) cards.splice(index, 1);
            else [cards[index], cards[index + direction]] = [cards[index + direction], cards[index]];
            renderDisplayDraft();
            renderDisplayPicker();
          });
          button.setAttribute("aria-label", `${direction === 0 ? "Убрать" : direction < 0 ? "Переместить влево" : "Переместить вправо"}: ${card.name}`);
          button.disabled = direction < 0 && index === 0 || direction > 0 && index === item.cards.length - 1;
          controls.append(button);
        });
        slot.append(controls);
      }
      grid.append(slot);
    });
    article.append(grid);
    if (!item.cards.length) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = editing ? "Выберите карты ниже — здесь появится ваша композиция." : "В этой витрине пока нет карт.";
      article.append(empty);
    }
    const footer = document.createElement("div");
    footer.className = "showcase-footer";
    footer.textContent = "✦ CHIZU GALLERY ✦";
    article.append(footer);
    return article;
  }

  function setDisplayMode(mode) {
    displayState.mode = mode;
    ["manager", "editor", "view"].forEach((key) => {
      el(key === "manager" ? "showcases-manager" : `showcase-${key}`).hidden = key !== mode;
    });
    showPage("showcases");
    window.scrollTo({ top: 0 });
  }

  async function loadShowcases() {
    setDisplayMode("manager");
    el("showcases-list").textContent = "Загружаем витрины…";
    el("showcase-new").disabled = true;
    try {
      const data = await api("/api/showcases");
      displayState.items = data.items;
      const list = el("showcases-list");
      list.replaceChildren();
      if (!data.items.length) list.textContent = "Ваша первая витрина начинается с любимой карты.";
      data.items.forEach((item) => {
        const row = document.createElement("div");
        row.className = "showcase-row";
        row.append(renderDisplay(item));
        const status = document.createElement("p");
        status.className = "hint";
        status.textContent = item.is_public ? "Открытая · доступна по ссылке" : "Личная · видна только вам";
        const actions = document.createElement("div");
        actions.className = "showcase-actions";
        actions.append(displayButton("Изменить", () => editShowcase(item)),
          displayButton("Открыть", () => openShowcase(item.token, "manager")));
        const remove = displayButton("Удалить витрину", async () => {
          if (!window.confirm(`Удалить витрину «${item.title}»? Карты останутся в коллекции.`)) return;
          remove.disabled = true;
          try { await api(`/api/showcases/${item.token}`, { method: "DELETE" }); await loadShowcases(); }
          finally { remove.disabled = false; }
        });
        row.append(status, actions, remove);
        list.append(row);
      });
      el("showcase-new").disabled = data.items.length >= 3;
    } catch (error) {
      el("showcases-list").textContent = "Не удалось загрузить витрины. Вернитесь в профиль и попробуйте снова.";
      throw error;
    }
  }

  async function editShowcase(item = null) {
    displayState.draft = item ? { ...item, cards: [...item.cards] } : {
      token: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      title: "", theme: "lunar", is_public: false, cards: [] };
    el("showcase-title").value = displayState.draft.title;
    el("showcase-theme").value = displayState.draft.theme;
    el("showcase-public").checked = displayState.draft.is_public;
    el("showcase-search").value = "";
    setDisplayMode("editor");
    renderDisplayDraft();
    await loadDisplayPicker(1);
  }

  function renderDisplayDraft() {
    const draft = displayState.draft;
    el("showcase-preview").replaceChildren(renderDisplay(draft, true));
    el("showcase-selected-count").textContent = `${draft.cards.length} / 9`;
    el("showcase-save").disabled = displayState.busy || !draft.cards.length || !draft.title.trim();
  }

  function renderDisplayPicker() {
    const picker = el("showcase-picker");
    picker.replaceChildren();
    if (!displayState.pickerItems.length) picker.textContent = "Карты не найдены. Попробуйте другой запрос или откройте новые карты.";
    displayState.pickerItems.forEach((card) => {
      const selected = displayState.draft.cards.some((c) => c.id === card.id);
      const button = cardButton(card, selected, false, () => {
        if (displayState.busy) return;
        const cards = displayState.draft.cards;
        const index = cards.findIndex((c) => c.id === card.id);
        if (index >= 0) cards.splice(index, 1);
        else if (cards.length < 9) cards.push(card);
        else { showNotice("В витрине может быть до девяти карт."); return; }
        renderDisplayDraft();
        renderDisplayPicker();
      }, "");
      button.setAttribute("aria-pressed", String(selected));
      picker.append(button);
    });
  }

  async function loadDisplayPicker(page) {
    const version = ++displayState.pickerVersion;
    el("showcase-picker").textContent = "Загружаем карты…";
    el("showcase-prev").disabled = el("showcase-next").disabled = true;
    try {
      const query = encodeURIComponent(el("showcase-search").value.trim());
      const data = await api(`/api/inventory?page=${page}&q=${query}`);
      if (version !== displayState.pickerVersion || displayState.mode !== "editor") return;
      displayState.pickerItems = data.items;
      displayState.pickerPage = data.page;
      displayState.pickerPages = data.pages;
      renderDisplayPicker();
      el("showcase-picker-page").textContent = `${data.page} / ${Math.max(1, data.pages)}`;
      el("showcase-prev").disabled = data.page <= 1;
      el("showcase-next").disabled = data.page >= data.pages;
    } catch (error) {
      if (version === displayState.pickerVersion) el("showcase-picker").textContent = "Ошибка загрузки. Нажмите «Найти», чтобы повторить.";
      throw error;
    }
  }

  async function openShowcase(token, returnPage = "account") {
    const item = await api(`/api/showcases/${encodeURIComponent(token)}`);
    displayState.viewed = item;
    displayState.returnPage = returnPage;
    setDisplayMode("view");
    el("showcase-display").replaceChildren(renderDisplay(item));
    el("showcase-author").textContent = `Коллекция игрока ${item.author}`;
    el("showcase-sharing").hidden = !item.link;
    el("showcase-link").value = item.link || "";
    el("showcase-share-status").textContent = item.link ? "" : "Личная витрина. Для отправки включите публикацию в редакторе.";
  }

  function backFromShowcases() {
    if (displayState.busy) return;
    if (displayState.mode === "editor" || displayState.returnPage === "manager") {
      displayState.returnPage = displayState.managerReturnPage;
      loadShowcases().catch(showError);
    } else showPage(displayState.returnPage);
  }
  el("showcases-open").addEventListener("click", () => {
    displayState.returnPage = displayState.managerReturnPage = "account";
    loadShowcases().catch(showError);
  });
  el("collection-showcases").addEventListener("click", () => {
    displayState.returnPage = displayState.managerReturnPage = "collection";
    loadShowcases().catch(showError);
  });
  el("showcases-back").addEventListener("click", backFromShowcases);
  el("showcase-new").addEventListener("click", () => editShowcase().catch(showError));
  el("showcase-cancel").addEventListener("click", backFromShowcases);
  el("showcase-title").addEventListener("input", () => {
    displayState.draft.title = el("showcase-title").value;
    el("showcase-preview").querySelector("h2").textContent = displayState.draft.title || "Моя витрина";
    el("showcase-save").disabled = displayState.busy || !displayState.draft.cards.length || !displayState.draft.title.trim();
  });
  el("showcase-theme").addEventListener("change", () => {
    displayState.draft.theme = el("showcase-theme").value;
    renderDisplayDraft();
  });
  el("showcase-search-button").addEventListener("click", () => loadDisplayPicker(1).catch(showError));
  el("showcase-search").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); loadDisplayPicker(1).catch(showError); }
  });
  el("showcase-prev").addEventListener("click", () => loadDisplayPicker(displayState.pickerPage - 1).catch(showError));
  el("showcase-next").addEventListener("click", () => loadDisplayPicker(displayState.pickerPage + 1).catch(showError));
  el("showcase-editor").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (displayState.busy) return;
    displayState.busy = true;
    const draft = displayState.draft;
    const body = JSON.stringify({ title: draft.title, theme: draft.theme,
      is_public: el("showcase-public").checked, card_ids: draft.cards.map((card) => card.id) });
    el("showcase-save").disabled = true;
    el("showcase-save").textContent = "Сохраняем…";
    el("showcase-editor").querySelectorAll("input, select, button").forEach((control) => { control.disabled = true; });
    try {
      await api(`/api/showcases/${draft.token}`, { method: "POST", body });
      await loadShowcases();
      showNotice("Витрина сохранена.");
    } catch (error) { showError(error); }
    finally {
      displayState.busy = false;
      el("showcase-editor").querySelectorAll("input, select, button").forEach((control) => { control.disabled = false; });
      renderDisplayDraft();
      el("showcase-prev").disabled = displayState.pickerPage <= 1;
      el("showcase-next").disabled = displayState.pickerPage >= displayState.pickerPages;
      el("showcase-save").textContent = "Сохранить";
    }
  });
  el("showcase-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(el("showcase-link").value); showNotice("Ссылка скопирована."); }
    catch { el("showcase-link").focus(); el("showcase-link").select(); }
  });
  el("showcase-share").addEventListener("click", async (event) => {
    const item = displayState.viewed;
    const button = event.currentTarget;
    if (!item?.link || button.disabled) return;
    const status = el("showcase-share-status");
    if (!tg?.shareMessage || !tg.isVersionAtLeast?.("8.0")) {
      status.textContent = "На этой версии Telegram отправится только ссылка. Обновите Telegram, чтобы добавить картинку.";
      const url = `https://t.me/share/url?url=${encodeURIComponent(item.link)}&text=${encodeURIComponent("Витрина в Chizu ✦")}`;
      if (tg?.openTelegramLink) tg.openTelegramLink(url);
      else window.open(url, "_blank", "noopener");
      return;
    }

    const stillViewing = () => state.activePage === "showcases" && displayState.mode === "view" &&
      displayState.viewed === item;
    button.disabled = true;
    button.textContent = "Готовим картинку…";
    status.textContent = "";
    try {
      const { message_id } = await api(`/api/showcases/${encodeURIComponent(item.token)}/share`, { method: "POST" });
      if (stillViewing()) tg.shareMessage(message_id);
    } catch (error) {
      if (stillViewing()) status.textContent = error.message || "Не удалось подготовить витрину. Попробуйте ещё раз.";
    } finally {
      button.disabled = false;
      button.textContent = "Поделиться";
    }
  });

  window.ChizuLoader?.set(0.62);
  async function startApp() {
    // Some mobile clients provide launch data shortly after the SDK is ready.
    for (let attempt = 0; !getInitData() && attempt < 20; attempt += 1) await pause(100);
    if (!getInitData()) {
      window.ChizuLoader?.fail("Откройте мини-приложение из Telegram.");
      showDropLoadError(new Error("Откройте мини-приложение из Telegram."));
      el("drop-retry").hidden = true;
      el("inventory-cards").replaceChildren();
    } else {
      loadProfile().then(() => {
        if (state.tradeToken) showPage("trade");
        const showcaseToken = new URLSearchParams(location.search).get("showcase");
        if (showcaseToken) openShowcase(showcaseToken).catch(showError);
        window.ChizuLoader?.finish();
      }).catch((error) => {
        showDropLoadError(error);
        window.ChizuLoader?.fail(error.message || "Не удалось загрузить профиль.");
      });
    }
  }
  startApp();
})();
