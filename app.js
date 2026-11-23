(() => {
  if (new URLSearchParams(location.search).get("monitor") === "1") {
    const source = new URL(document.currentScript.src);
    const script = document.createElement("script");
    script.src = new URL(`monitor.js${source.search}`, source).href;
    script.onerror = () => window.ChizuLoader?.fail("Не удалось загрузить мониторинг. Откройте его заново.");
    document.body.append(script);
    return;
  }
  const DROP_COOLDOWN_SEC = 3600;
  const DROP_MIN_OPEN_MS = 380;
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
    { key: "special_numbers", title: "Особые номера" },
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
    marketItems: [], activePage: "home",
    collectionTotal: 0, ownedCardCount: 0,
    favorites: [], favoriteLimit: 20, shopFrames: [], framePacks: [], packOpening: false,
    frameShopCards: [], frameShopPage: 1, frameShopPages: 1,
    frameShopCardId: null, frameShopFrameId: null, framePreviewVersion: 0,
    frameShopPinnedCard: null, frameShopCardsVersion: 0,
    tradeSubmitting: false, transferSubmitting: false, listingSubmitting: false,
    caseCatalog: null, caseOpening: false,
    economyBusy: false,
    referralLink: "",
    collectionItems: [], collectionLoading: false, selectMode: false,
    marketTab: "all", shopTab: "frames", lastDropCard: null,
    dropStartedAt: 0, dropStageTimer: 0, dropTimer: 0, dropReadyAt: 0, dropBusy: false,
    mainClick: null, overlayOpen: false,
    publicPlayer: null, publicInventoryPage: 0,
    publicInventoryLoading: false, publicInventoryIds: new Set(),
    availableBackgrounds: [],
    backgroundCatalogRequest: null, backgroundSaving: false, backgroundSaveVersion: 0,
  };
  const el = (id) => document.getElementById(id);
  const albums = { series: null, page: 1, listPage: 1, version: 0, favorites: false };
  const copies = { page: 1, version: 0, selected: new Map(), maxBatch: 0, busy: false };
  const pagePositions = new Map();
  const loadedCollectionModes = new Set();
  let sheetBack = null;
  let sheetReturnFocus = null;
  let detailAnchor = null;
  const playerPreference = (name, value) => {
    const id = state.profile?.id;
    if (!id) return null;
    try {
      const key = `chizu:${id}:${name}`;
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (_error) { /* Storage may be disabled by the client. */ }
    return null;
  };

  function rememberCollectionSettings() {
    const settings = {
      mode: state.collectionMode, query: state.collectionQuery, filter: state.collectionFilter,
      rarity: state.collectionRarity, sort: state.collectionSort, series: albums.series,
      albumPage: albums.page, albumListPage: albums.listPage, copiesPage: copies.page,
    };
    playerPreference("collection-settings", JSON.stringify(settings));
  }

  function restoreCollectionSettings() {
    let saved;
    try { saved = JSON.parse(playerPreference("collection-settings") || "null"); }
    catch (_error) { return; }
    if (!saved) return;
    if (["cards", "albums", "duplicates", "frames"].includes(saved.mode)) state.collectionMode = saved.mode;
    if (typeof saved.query === "string") {
      state.collectionQuery = saved.query.slice(0, 100);
      el("collection-search").value = state.collectionQuery;
    }
    if (COLLECTION_FILTERS.some(({ key }) => key === saved.filter)) state.collectionFilter = saved.filter;
    if (RARITIES.some(({ key }) => key === saved.rarity)) state.collectionRarity = saved.rarity;
    if (SORTS.some(({ key }) => key === saved.sort)) state.collectionSort = saved.sort;
    if (typeof saved.series === "string") albums.series = saved.series;
    if (Number.isSafeInteger(saved.albumPage) && saved.albumPage > 0) albums.page = saved.albumPage;
    if (Number.isSafeInteger(saved.albumListPage) && saved.albumListPage > 0) albums.listPage = saved.albumListPage;
    if (Number.isSafeInteger(saved.copiesPage) && saved.copiesPage > 0) copies.page = saved.copiesPage;
  }
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
  function quantityForm(count, one, few, many) {
    const lastTwo = count % 100;
    const last = count % 10;
    if (lastTwo >= 11 && lastTwo <= 14) return many;
    return last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  }
  const cardWord = (count) => quantityForm(count, "карта", "карты", "карт");
  const formatCardCount = (count) => `${count} ${cardWord(count)}`;
  const formatCrystalCount = (count) => `${count} ${quantityForm(count, "кристалл", "кристалла", "кристаллов")}`;
  const selectedCards = () => [...state.selected.values()];
  const hasCustomFrame = (card) => Boolean(card.frame_style && card.frame_style !== "classic");
  const frameHandoffWarning = (cards) => {
    const framed = cards.filter(hasCustomFrame);
    return framed.length
      ? `Особых рамок на картах: ${framed.length}. Они перейдут новым владельцам вместе с картами.`
      : "Любая надетая особая рамка переходит новому владельцу вместе с картой.";
  };
  const rarityClass = (rarity) => `rarity-${rarity}`;
  const formatPrintNumber = (card) => `№${String(card.print_no).padStart(3, "0")}`;

  function printNumberLabel(card) {
    const label = document.createElement("span");
    const marks = { first: "Первый экземпляр", repeat: "Повтор цифр", round: "Круглый номер" };
    label.className = card.print_mark ? "print-seal" : "print-number";
    label.textContent = [formatPrintNumber(card), marks[card.print_mark]].filter(Boolean).join(" · ");
    return label;
  }

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

  const recoverablePurchase = /^\/api\/(?:drop(?:\/all|\/extra)?|rolls\/(?:buy|dust)|cases\/open|frames\/(?:buy|recycle|packs\/(?:buy|open))|cards\/\d+\/(?:upgrade|downgrade)|collection\/albums\/claim|craft)$/;
  const newRequestId = () => crypto.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  let pendingOperation = null;
  let economyRequestBusy = false;

  async function requestApi(path, options = {}, quick = false) {
    const initData = getInitData();
    const method = (options.method || "GET").toUpperCase();
    const { idempotencyKey, ...networkOptions } = options;
    const requestOptions = {
      ...networkOptions,
      headers: {
        Authorization: `tma ${initData}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        ...options.headers,
      },
    };
    let response;
    const attempts = method === "GET" && !quick ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), method === "GET" ? 8000 : 15000);
      try {
        response = await fetch(`${apiBase}${path}`, {
          ...requestOptions,
          signal: controller.signal,
        });
        if (method !== "GET" || ![502, 503, 504].includes(response.status) || attempt === attempts - 1) {
          const data = response.headers.get("content-type")?.includes("application/json")
            ? await response.json() : null;
          if (!response.ok) {
            throw Object.assign(new Error(data?.error || `Ошибка сервера (${response.status})`),
              { status: response.status, code: data?.code, retryable: response.status >= 500 });
          }
          return data;
        }
        await response.body?.cancel();
      } catch (error) {
        if (error.status) throw error;
        if (attempt === attempts - 1) {
          throw Object.assign(new Error("Нет ответа от сервера. Проверьте соединение."), { retryable: true });
        }
      } finally {
        clearTimeout(timeout);
      }
      await pause((attempt + 1) * 500);
    }
  }

  function rememberOperation(operation) {
    pendingOperation = operation;
    playerPreference("pending-operation", operation ? JSON.stringify(operation) : "");
    el("operation-recovery").hidden = !operation;
    if (operation) el("operation-status").textContent = "Проверить результат последней операции";
  }

  async function sendEconomyOperation(operation, verifyFirst) {
    const check = () => requestApi(`/api/operations/${operation.id}`, {}, true);
    const send = () => requestApi(operation.path, {
      method: "POST", body: operation.body, idempotencyKey: operation.id,
    });
    const run = async () => {
      if (verifyFirst) await check();
      try { return await send(); }
      catch (error) {
        if (!error.retryable || verifyFirst || !navigator.onLine) throw error;
        await check();
        return send();
      }
    };
    try {
      const result = await run();
      rememberOperation(null);
      return result;
    } catch (error) {
      if (!error.retryable && error.status !== 401 && error.status !== 403) rememberOperation(null);
      throw error;
    }
  }

  async function api(path, options = {}) {
    if (options.method !== "POST" || !recoverablePurchase.test(path)) return requestApi(path, options);
    const body = options.body || "{}";
    if (economyRequestBusy) throw new Error("Предыдущая операция ещё обрабатывается.");
    const previous = pendingOperation;
    if (previous && (path !== previous.path || body !== previous.body)) {
      throw new Error("Сначала проверьте результат предыдущей операции.");
    }
    const operation = previous || { path, body, id: newRequestId(), ts: Date.now() };
    economyRequestBusy = true;
    if (!previous) {
      pendingOperation = operation;
      playerPreference("pending-operation", JSON.stringify(operation));
    }
    try { return await sendEconomyOperation(operation, Boolean(previous)); }
    finally {
      economyRequestBusy = false;
      if (pendingOperation) rememberOperation(operation);
    }
  }

  function restorePendingOperation() {
    try {
      const saved = JSON.parse(playerPreference("pending-operation") || "null");
      if (saved && recoverablePurchase.test(saved.path) && /^[\w-]{8,80}$/.test(saved.id)
          && typeof saved.body === "string" && Date.now() - saved.ts < 6 * 86400000) {
        rememberOperation(saved);
      }
    } catch (_error) { playerPreference("pending-operation", ""); }
  }

  async function recoverEconomyOperation() {
    if (!pendingOperation || economyRequestBusy) return;
    const button = el("operation-retry");
    economyRequestBusy = button.disabled = true;
    el("operation-status").textContent = "Проверяем исходную операцию…";
    const operation = pendingOperation;
    try {
      const result = await sendEconomyOperation(operation, true);
      await loadProfile().catch(showDropLoadError);
      if (state.activePage === "crystals") setShopTab(state.shopTab);
      state.collectionVisited = false;
      if (state.activePage === "collection") refreshCollection();
      const cards = result.cards || (result.card ? [result.card] : []);
      if (operation.path.startsWith("/api/drop") && cards.length) {
        startDropOpening();
        clearTimeout(state.dropStageTimer);
        showDropResults(cards);
      } else if (operation.path === "/api/cases/open") {
        openInfoPopup("Кейс открыт", caseRewardSummary(result));
      } else if (operation.path === "/api/frames/packs/open") {
        openInfoPopup("Пак открыт", `Получена рамка «${result.frame.title}».`);
      } else if (operation.path === "/api/craft" && cards.length) {
        closeSheet();
        startDropOpening({ crafted: true });
        await playDropReveal(cards);
      } else if (operation.path.endsWith("/downgrade") && result.card) {
        applyCardUpdate(result.card);
        showNotice(`Улучшение снято. Возвращено ${result.refund} пыли.`);
      } else {
        showNotice("Операция подтверждена. Баланс обновлён.");
      }
    } catch (error) {
      if (pendingOperation) rememberOperation(operation);
      showError(error);
    } finally {
      economyRequestBusy = button.disabled = false;
    }
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
    state.lastErrorLocation = bugReportLocation();
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
    const after = state.afterInfo;
    state.afterInfo = null;
    after?.();
  }

  function withFirstTip(name, title, text, action) {
    if (playerPreference(`tip:${name}`) || state.seenTips?.has(name)) return action();
    state.seenTips ||= new Set();
    state.seenTips.add(name);
    playerPreference(`tip:${name}`, "1");
    openInfoPopup(title, text);
    state.afterInfo = () => Promise.resolve().then(action).catch(showError);
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
      !el("frame-roulette").hidden || !el("info-popup").hidden || !el("shop-dialog").hidden ||
      el("vip-history-dialog").open || el("frame-shop-preview").open ||
      state.activePage === "player" || state.activePage === "showcases" ||
      (state.activePage === "collection" && state.collectionMode === "albums" && albums.series !== null);
    if (!tg?.BackButton) return;
    try {
      if (open) tg.BackButton.show();
      else tg.BackButton.hide();
    } catch (_error) { /* old clients */ }
  }

  function showPage(name, { loadShop = true } = {}) {
    haptic("light");
    const previous = state.activePage;
    if (name === "account" && previous !== "account") state.reportPreviousScreen = bugReportLocation();
    if (previous !== name) pagePositions.set(previous, window.scrollY);
    if (previous === "collection" && previous !== name) rememberCollectionSettings();
    state.activePage = name;
    syncAppBackground();
    document.querySelectorAll(".page-view").forEach((page) => {
      page.hidden = page.id !== `${name}-page`;
    });
    document.querySelectorAll(".main-nav button").forEach((button) => {
      const active = button.dataset.page === name;
      button.classList.toggle("active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (name === "collection" && (!state.collectionVisited ||
        (previous !== name && state.collectionMode === "frames"))) refreshCollection();
    renderCollectionSelection();
    if (name === "account") loadAccountPage();
    if (name === "crystals" && state.shopTab === "frames" && loadShop) {
      loadFrameShop().catch(showError);
    }
    if (name === "crystals" && state.shopTab === "cases" && loadShop) {
      loadCaseCatalog().catch(showError);
    }
    if (name === "trade") {
      setMarketTab(state.tradeToken ? "trade" : state.marketTab, true);
    }
    if (previous !== name) window.scrollTo(0, pagePositions.get(name) || 0);
    syncBackButton();
  }

  function setBalance(balance) {
    state.balance = balance;
    el("balance").textContent = String(balance);
    renderEconomyStatus();
  }
  function setProfileAvatar(id, profile) {
    const avatar = el(id);
    if (!avatar) return;
    avatar.replaceChildren(icon("profile"));
    avatar.dataset.photoUrl = profile.photo_url || "";
    if (profile.photo_url) {
      const image = document.createElement("img");
      image.alt = "";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.addEventListener("load", () => {
        if (avatar.dataset.photoUrl === profile.photo_url) avatar.replaceChildren(image);
      }, { once: true });
      image.src = profile.photo_url;
    }
    avatar.setAttribute("aria-label", `Аватар: ${profile.display_name}`);
  }
  function setCrystals(balance) {
    state.crystals = balance;
    el("crystals-balance").textContent = balance;
    el("crystal-shop-balance").textContent = formatCrystalCount(balance);
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
    return quantityForm(amount, "билет", "билета", "билетов");
  }
  function updateRollShopButtons() {
    const input = el("ticket-amount");
    const button = el("buy-tickets-button");
    const maximum = Math.max(1, state.maxRollPurchaseBatch);
    const amount = input.valueAsNumber;
    const valid = Number.isSafeInteger(amount) && amount >= 1 && amount <= maximum;
    input.max = String(maximum);
    button.dataset.buyRolls = valid ? String(amount) : "";
    el("ticket-amount-label").textContent = valid ? `${amount} ${ticketWord(amount)}` : "—";
    el("ticket-cost").textContent = valid ? formatCrystalCount(amount * state.rollCrystalCost) : "—";
    input.disabled = state.ticketPurchaseInProgress;
    button.disabled = state.ticketPurchaseInProgress || !valid;
    document.querySelectorAll("[data-ticket-amount]").forEach((quick) => {
      const value = Number(quick.dataset.ticketAmount);
      quick.disabled = state.ticketPurchaseInProgress || value > maximum;
      quick.setAttribute("aria-pressed", String(value === amount));
    });
    el("ticket-shop-hint").textContent = valid ? "" : `Можно выбрать до ${maximum} ${ticketWord(maximum)}.`;
  }

  function openWallet(currency, { missing = 0, onBack } = {}) {
    const body = document.createElement("div");
    body.className = "wallet-actions";
    const titles = { dust: "Пыль", crystals: "Кристаллы", rolls: "Билеты" };
    const balance = document.createElement("strong");
    balance.textContent = `На балансе: ${currency === "dust" ? state.balance : state[currency]}`;
    body.append(balance);
    if (currency === "dust" && missing) {
      const note = document.createElement("p");
      note.className = "hint";
      note.textContent = `Не хватает ${missing} пыли.`;
      body.append(note);
    }
    const shop = (tab) => {
      closeSheet();
      showPage("crystals", { loadShop: false });
      setShopTab(tab);
      window.scrollTo(0, 0);
    };
    if (currency === "dust") {
      body.append(displayButton("Билеты за пыль", () => shop("rolls")),
        displayButton("Создать карту", () => shop("craft")),
        displayButton("Улучшить карту", () => { closeSheet(); showPage("collection"); }),
        displayButton("Паки рамок", () => shop("frames")),
        displayButton("Маркет", () => { closeSheet(); showPage("trade"); setMarketTab("all"); }));
    } else if (currency === "crystals") {
      const note = document.createElement("p");
      note.className = "hint";
      if (missing) {
        note.textContent = `Не хватает ${formatCrystalCount(missing)}.`;
        body.append(note);
      }
      body.append(displayButton("Пополнить кристаллы", () => shop("gems"), false));
      if (!onBack) body.append(displayButton("Билеты", () => shop("rolls")),
        displayButton("Паки рамок", () => shop("frames")), displayButton("Кейсы", () => shop("cases")));
    } else {
      body.append(state.rolls ? displayButton("К открытию карты", () => {
        closeSheet();
        showPage("home");
        el("home-ticket-panel").scrollIntoView({ block: "center" });
      }, false) : displayButton("Купить билеты", () => shop("rolls"), false));
    }
    if (onBack) body.append(displayButton("Вернуться к товару", onBack, false));
    const history = document.createElement("section");
    history.className = "wallet-history";
    body.append(history);
    openSheet(titles[currency], body, null, onBack);
    loadWalletHistory(currency, history);
  }

  async function loadWalletHistory(currency, container, before = null) {
    const units = { dust: "пыли", crystals: "кристаллов", rolls: "бил." };
    const reasons = {
      crystals_purchased: "Покупка за Telegram Stars",
      admin_grant: "Корректировка баланса", daily_reward_claimed: "Ежедневная награда",
      dust: "Распыление карт", dust_ticket_purchased: "Билет за пыль",
      rolls_purchased: "Билеты за кристаллы", extra_roll_used: "Призыв за билет",
      card_crafted: "Создание карты", card_upgraded: "Улучшение карты",
      card_upgrade_removed: "Возврат за снятие улучшения", case_shards_converted: "Обмен осколков на пыль",
      case_opened: "Открытие кейса", case_reward: "Награда из кейса", case_duplicate: "Дубликат из кейса",
      frame_purchased: "Покупка рамки", frame_pack_purchased: "Покупка пака рамок",
      frame_pack_opened: "Открытие пака рамок", frame_pack_duplicate: "Дубликат рамки",
      album_reward_claimed: "Награда за альбом", frame_recycled: "Распыление рамки",
      bid_reserve: "Резерв ставки", bid_refund: "Возврат резерва", auction_sale: "Продажа карты",
    };
    if (!before) {
      const title = document.createElement("h3");
      title.textContent = "История операций";
      container.replaceChildren(title);
    }
    const status = document.createElement("div");
    status.className = "hint";
    status.textContent = "Загружаем историю…";
    container.append(status);
    try {
      const suffix = before ? `?before=${before}` : "";
      const data = await api(`/api/wallet/${currency}${suffix}`);
      if (!container.isConnected) return;
      status.remove();
      if (!data.items.length && !before) {
        status.textContent = "История пока пуста.";
        container.append(status);
      }
      for (const entry of data.items) {
        const row = document.createElement("article");
        row.className = "wallet-entry";
        const amount = document.createElement("strong");
        amount.className = entry.amount > 0 ? "wallet-credit" : "wallet-debit";
        amount.textContent = `${entry.amount > 0 ? "+" : "−"}${Math.abs(entry.amount)} ${units[currency]}`;
        const label = document.createElement("div");
        label.textContent = reasons[entry.reason] || "Операция";
        const time = document.createElement("time");
        time.className = "hint";
        time.dateTime = new Date(entry.ts * 1000).toISOString();
        time.textContent = localDateTime(entry.ts);
        row.append(label, amount, time);
        if (entry.price !== null) {
          const sale = document.createElement("p");
          sale.className = "hint";
          sale.textContent = `Цена ${entry.price} · Комиссия ${entry.commission} · Начислено ${entry.amount} пыли`;
          row.append(sale);
        }
        if (entry.listing_id) {
          row.append(displayButton(`Лот #${entry.listing_id}`, async () => {
            const wallet = el("sheet-body").firstElementChild;
            const back = sheetBack;
            const { listing } = await api(`/api/market/${entry.listing_id}`);
            if (!row.isConnected || el("sheet").hidden) return;
            openSheet(`Аукцион #${entry.listing_id}`, listingCard(listing), null,
              () => openSheet({ dust: "Пыль", crystals: "Кристаллы", rolls: "Билеты" }[currency], wallet, null, back));
          }));
        }
        container.append(row);
      }
      if (data.next_before) {
        const more = displayButton("Ещё операции", () => {
          more.remove();
          return loadWalletHistory(currency, container, data.next_before);
        });
        container.append(more);
      }
    } catch (error) {
      status.replaceChildren(displayButton("Повторить загрузку истории", () => {
        status.remove();
        return loadWalletHistory(currency, container, before);
      }));
      showError(error);
    }
  }

  function formatDuration(seconds) {
    const value = Math.max(0, seconds);
    const hours = Math.floor(value / 3600);
    const minutes = Math.floor((value % 3600) / 60);
    const remainder = value % 60;
    if (hours) return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  }

  const localDateTime = (seconds) => new Date(seconds * 1000).toLocaleString("ru-RU", {
    dateStyle: "short", timeStyle: "short",
  });

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon-sm");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#icon-${name}`);
    svg.append(use);
    return svg;
  }

  function frameEffects(effect, cardRarity = "epic", frameRarity = "epic", accent, ornamentUrl, theme, motionUrl) {
    if (!effect || (!motionUrl && !/^[a-z_]+$/.test(effect))) return null;
    const fx = document.createElement("span");
    fx.setAttribute("aria-hidden", "true");
    if (cardRarity === "legendary" || cardRarity === "mythical") {
      fx.style.inset = "2.83% 4.13%";
    }
    if (motionUrl) {
      fx.className = "frame-live-fx frame-live-fx--motion";
      const moduleUrl = new URL("frame-motion.js", staticBase);
      if (appVersion) moduleUrl.searchParams.set("v", appVersion);
      import(moduleUrl.href)
        .then(({ mountFrameMotion }) => mountFrameMotion(fx, effect, frameAssetUrl(motionUrl)))
        .catch(() => fx.remove());
      return fx;
    }
    const premium = frameRarity === "legendary" || frameRarity === "mythical";
    fx.className = `frame-live-fx frame-live-fx--${effect} frame-live-fx--tier-${premium ? "ssr" : frameRarity === "epic" ? "sr" : "r"}`;
    fx.dataset.theme = theme || "";
    if (accent) fx.style.setProperty("--fx-color", accent);
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

  function loadCardImageUrl(card, tradeToken = "", frameStyle = card.frame_style, liveFrame = true) {
    const cacheKey = `${card.id}:${frameStyle || "legacy"}:${card.upgrade_level || 0}:${tradeToken || ""}:${Number(liveFrame)}`;
    const cachedUrl = state.imageUrls.get(cacheKey);
    if (cachedUrl) return Promise.resolve(cachedUrl);
    let imagePromise = state.imagePromises.get(cacheKey);
    if (imagePromise) return imagePromise;
    const imageQuery = new URLSearchParams();
    if (liveFrame) imageQuery.set("live_frame", "1");
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

  function cardButton(card, selected, disabled, onClick, tradeToken = state.tradeToken, previousImageUrl, inspect = false) {
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
      card.frame_accent, card.frame_ornament_url, card.frame_theme, inspect ? card.frame_motion_url : null);
    if (frameFx) button.append(frameFx);
    const marks = document.createElement("span");
    marks.className = "card-marks";
    if (card.lock_reason) {
      const lock = document.createElement("span");
      lock.className = "mark-pill";
      lock.append(icon("lock"));
      marks.append(lock);
    }
    if (favorite) {
      const star = document.createElement("span");
      star.className = "mark-pill mark-favorite";
      star.append(icon("heart"));
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
    loadCardImageUrl(card, tradeToken, card.frame_style, inspect || !card.frame_motion_url).then((url) => {
      image.src = url;
    }).catch(showError);
    return button;
  }

  function bindHomeSummonTilt() {
    const card = el("home-summon");
    const arrowSteps = new Map([
      ["ArrowLeft", [-8, 0]],
      ["ArrowRight", [8, 0]],
      ["ArrowUp", [0, 8]],
      ["ArrowDown", [0, -8]],
    ]);
    let drag = null;
    let tiltX = 0;
    let tiltY = 0;

    function setTilt(x, y) {
      tiltX = Math.max(-24, Math.min(24, x));
      tiltY = Math.max(-30, Math.min(30, y));
      card.style.setProperty("--card-tilt-x", `${tiltX}deg`);
      card.style.setProperty("--card-tilt-y", `${tiltY}deg`);
    }

    card.addEventListener("pointerdown", (event) => {
      if (drag || !event.isPrimary || event.button !== 0) return;
      card.setPointerCapture(event.pointerId);
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, tiltX, tiltY };
      card.classList.add("is-dragging");
    });
    card.addEventListener("pointermove", (event) => {
      if (drag?.id !== event.pointerId) return;
      setTilt(drag.tiltX - (event.clientY - drag.y) * 0.5, drag.tiltY + (event.clientX - drag.x) * 0.5);
    });
    function endDrag(event) {
      if (drag?.id !== event.pointerId) return;
      drag = null;
      card.classList.remove("is-dragging");
      setTilt(0, 0);
    }
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((type) => {
      card.addEventListener(type, endDrag);
    });
    card.addEventListener("keydown", (event) => {
      if (drag) return;
      const step = arrowSteps.get(event.key);
      if (step) {
        event.preventDefault();
        setTilt(tiltX + step[1], tiltY + step[0]);
      } else if (event.key === "Escape" && (tiltX || tiltY)) {
        event.stopPropagation();
        setTilt(0, 0);
      }
    });
    card.addEventListener("blur", () => {
      if (!drag) setTilt(0, 0);
    });
  }

  function updateDropButton() {
    const stock = state.profile?.free_drops;
    const free = stock?.available ?? 0;
    const maximum = stock?.maximum ?? 5;
    const first = state.profile && !state.profile.has_summoned && !state.ownedCardCount;
    const onlySingle = first || free < 2;
    el("free-drop-count").textContent = stock ? `${free} / ${maximum}` : `— / ${maximum}`;
    el("drop-slots").querySelectorAll("i").forEach((slot, index) => {
      slot.classList.toggle("filled", index < free);
    });
    el("drop-actions").hidden = free === 0;
    el("drop-actions").classList.toggle("single", onlySingle);
    el("drop-all-button").hidden = onlySingle;
    const single = el("drop-button");
    single.classList.toggle("btn-primary", onlySingle);
    single.classList.toggle("btn-secondary", !onlySingle);
    single.textContent = first ? "Открыть первую карту" : free > 1 ? "Открыть одну" : "Открыть карту";
    single.disabled = !stock || !free || state.dropBusy;
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
    const firstReady = !state.profile.has_summoned && stock.available > 0;
    const timer = el("drop-timer");
    updateDropButton();
    if (!seconds && stock.next_in != null) {
      if (!firstReady) timer.textContent = "Обновляем запас…";
      loadProfile().catch(showDropLoadError);
      return;
    }
    const ring = el("drop-ring");
    timer.textContent = stock.next_in == null ? "Запас полон"
      : firstReady ? "Первое открытие доступно"
      : `Пополнение через ${formatDuration(seconds)}`;
    const cooldown = state.profile.drop_cooldown_duration || DROP_COOLDOWN_SEC;
    ring.style.setProperty("--progress", String(Math.max(0, Math.min(1, 1 - seconds / cooldown))));
    if (seconds > 0) state.dropTimer = window.setTimeout(updateDropTimer, 1000);
  }

  function updateProfileTier(profile) {
    const isVip = Boolean(profile.vip.active);
    el("account-page").classList.toggle("profile--vip", isVip);
    el("account-avatar").classList.toggle("vip-avatar", isVip);
    el("profile-tier-badge").hidden = !isVip;
  }

  let starPaymentBusy = false;

  function renderStarPacks() {
    const container = el("crystal-star-packs");
    const packs = state.profile?.crystal_star_packs || [];
    container.replaceChildren(...packs.map((pack, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "crystal-pack";
      button.dataset.tier = index + 1;
      const art = document.createElement("span");
      art.className = "crystal-pack-art";
      art.setAttribute("aria-hidden", "true");
      const quantity = document.createElement("strong");
      quantity.textContent = formatCrystalCount(pack.crystals);
      const price = document.createElement("span");
      price.className = "crystal-pack-price";
      price.textContent = `${pack.stars} ★ Stars`;
      button.append(art, quantity, price);
      button.disabled = starPaymentBusy || !tg?.openInvoice;
      button.addEventListener("click", () => buyStarPack(pack.id));
      return button;
    }));
  }

  async function buyStarPack(packId) {
    if (starPaymentBusy || !tg?.openInvoice) return;
    starPaymentBusy = true;
    renderStarPacks();
    const status = el("crystal-payment-status");
    status.textContent = "Открываем оплату…";
    try {
      const invoice = await api("/api/payments/stars", {
        method: "POST", body: JSON.stringify({ pack_id: packId }),
      });
      const result = await new Promise(resolve => tg.openInvoice(invoice.invoice_url, resolve));
      if (result === "cancelled" || result === "failed") {
        status.textContent = result === "cancelled" ? "Оплата отменена." : "Оплата не прошла. Можно попробовать снова.";
        return;
      }
      status.textContent = "Проверяем оплату…";
      for (let attempt = 0; attempt < 15; attempt++) {
        const payment = await api(`/api/payments/stars/${encodeURIComponent(invoice.order)}`);
        if (payment.paid) {
          await loadProfile();
          status.textContent = "Кристаллы зачислены.";
          return;
        }
        await pause(1000);
      }
      status.textContent = "Платёж ещё обрабатывается. Бот сообщит о зачислении. Помощь — /paysupport.";
    } catch (error) {
      status.textContent = `Не удалось проверить оплату: ${error.message}. Если Stars списаны, дождитесь сообщения бота или отправьте /paysupport.`;
    } finally {
      starPaymentBusy = false;
      renderStarPacks();
    }
  }

  async function fetchOwnProfile() {
    const backgroundSaveVersion = state.backgroundSaveVersion;
    const profile = await api("/api/me");
    if (backgroundSaveVersion !== state.backgroundSaveVersion) {
      profile.profile_background = state.profile.profile_background;
    }
    state.profile = profile;
    renderUpdateChannel(profile);
    renderStarPacks();
    renderCraftRarities();
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
    updateProfileTier(profile);
    state.ownedCardCount = profile.card_count;
    el("card-count").textContent = state.ownedCardCount;
    el("welcome").textContent = profile.display_name;
    el("daily-button").disabled = !profile.daily_reward_available;
    el("daily-button").textContent = profile.daily_reward_available ? "Забрать" : "Получено";
    el("daily-status").textContent = profile.daily_reward_available
      ? `Ежедневная награда: ${profile.vip_daily_reward} пыли${
        profile.updates_channel_url ? " · для подписчиков" : ""}${
        profile.vip.active ? " · VIP-бонус" : ""}`
      : `Следующая награда: ${localDateTime(profile.next_daily_reset)}`;
    const showingEmptyCollection = !el("collection-empty").hidden;
    if (state.collectionVisited && state.collectionMode === "cards" &&
        showingEmptyCollection !== (profile.card_count === 0)) {
      state.collectionVisited = false;
      if (state.activePage === "collection") refreshCollection();
    }
    updateDropTimer();
  }

  const dropMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let dropSession = null;
  function stopDropMotion() {
    if (!dropSession || dropSession.cancelled || el("drop-overlay").classList.contains("is-results")) return;
    dropSession.skipped = true;
    dropSession.wake?.();
    el("drop-overlay").classList.add("is-skipped");
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopDropMotion();
  });
  dropMotion.addEventListener?.("change", () => {
    if (dropMotion.matches) stopDropMotion();
  });

  function startDropOpening({ gift = false, crafted = false } = {}) {
    const overlay = el("drop-overlay");
    const session = { skipped: false, cancelled: false, wake: null, gift, crafted };
    dropSession = session;
    overlay.hidden = false;
    overlay.className = "drop-overlay is-opening";
    state.dropStartedAt = performance.now();
    el("drop-close").hidden = true;
    el("drop-skip").hidden = false;
    el("drop-followup").hidden = true;
    el("drop-results").hidden = true;
    el("drop-results").replaceChildren();
    el("drop-sequence").hidden = true;
    el("drop-progress").hidden = true;
    el("drop-to-results").hidden = true;
    el("drop-title").textContent = gift ? "Распаковываем подарок…" : crafted ? "Создаём карту…" : "Призываем карту…";
    el("drop-rarity").textContent = "";
    el("drop-description").textContent = "Соединяемся со звёздами…";
    el("drop-portal").setAttribute("aria-hidden", "true");
    el("drop-revealed-card").replaceChildren();
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
    el("drop-sequence").replaceChildren();
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

  function prepareDropImage(card, image, session, timeout) {
    image.loading = "eager";
    return new Promise((resolve) => {
      const finish = (ready) => {
        clearTimeout(timer);
        if (session.wake === cancel) session.wake = null;
        resolve(ready);
      };
      const cancel = () => finish(false);
      const timer = setTimeout(cancel, timeout);
      session.wake = cancel;
      loadCardImageUrl(card, "").then(async (url) => {
        image.src = url;
        await image.decode();
        finish(true);
      }).catch(() => finish(false));
    });
  }

  async function revealDrop(card, session) {
    const overlay = el("drop-overlay");
    const cardElement = cardButton(card, false, false, null, "");
    cardElement.tabIndex = -1;
    el("drop-revealed-card").replaceChildren(cardElement);
    el("drop-description").textContent = "Подготавливаем изображение карты…";
    const ready = await prepareDropImage(card, cardElement.querySelector("img"), session, 2400);
    if (session.skipped || session.cancelled) return;
    if (!ready) {
      showNotice("Карта сохранена. Изображение ещё загружается — его можно посмотреть в коллекции.");
      return;
    }
    el("drop-title").textContent = session.crafted ? "Карта создана" : "Призыв";
    el("drop-description").textContent = "";
    overlay.className = `drop-overlay is-revealing ${rarityClass(card.rarity)}`;
    haptic(card.rarity === "mythical" || card.rarity === "legendary" ? "heavy" : "medium");
    await dropWait(session, 900);
    if (session.skipped || session.cancelled) return;
    overlay.className = `drop-overlay is-revealed ${rarityClass(card.rarity)}`;
    el("drop-rarity").textContent = card.rarity_title;
    el("drop-description").textContent = card.name;
    if (session.gift && card.print_mark) {
      const seal = printNumberLabel(card);
      seal.classList.add("gift-print-flash");
      el("drop-revealed-card").append(seal);
    }
    await dropWait(session, 600);
  }

  async function revealDropSequence(cards, session) {
    if (session.skipped || session.cancelled) return;
    const grid = el("drop-sequence");
    const progress = el("drop-progress");
    const revealFx = el("drop-portal").querySelector(".drop-reveal-fx");
    const tiles = cards.map((card) => {
      const tile = document.createElement("div");
      tile.className = "drop-sequence-tile";
      const turn = document.createElement("div");
      turn.className = "drop-sequence-turn";
      const face = cardButton(card, false, false, null, "");
      face.classList.add("drop-sequence-face");
      face.tabIndex = -1;
      turn.append(face);
      tile.append(turn, revealFx.cloneNode(true));
      return tile;
    });
    grid.replaceChildren(...tiles);
    grid.dataset.count = cards.length;
    grid.hidden = false;
    progress.textContent = `0 / ${cards.length}`;
    progress.hidden = false;
    el("drop-overlay").className = "drop-overlay is-sequence";
    el("drop-title").textContent = "Призыв";
    el("drop-description").textContent = "";
    el("drop-to-results").hidden = false;
    await dropWait(session, 280);

    for (const [index, card] of cards.entries()) {
      if (session.skipped || session.cancelled || document.hidden) break;
      const tile = tiles[index];
      const ready = await prepareDropImage(card, tile.querySelector("img"), session, 1000);
      if (!ready || session.skipped || session.cancelled || document.hidden) break;
      tile.classList.add("is-flipped", rarityClass(card.rarity));
      progress.textContent = `${index + 1} / ${cards.length} · ${card.name} · ${card.rarity_title}`;
      haptic(card.rarity === "mythical" || card.rarity === "legendary" ? "heavy" : "medium");
      await dropWait(session, 730);
    }
  }

  function showDropResults(cards) {
    const single = cards.length === 1;
    state.lastDropCard = single ? cards[0] : null;
    const overlay = el("drop-overlay");
    overlay.className = single
      ? `drop-overlay is-results is-single-result ${rarityClass(cards[0].rarity)}`
      : "drop-overlay is-results is-batch-result";
    el("drop-sequence").hidden = true;
    el("drop-sequence").replaceChildren();
    el("drop-progress").hidden = true;
    el("drop-to-results").hidden = true;
    if (single) {
      const card = cards[0];
      const face = el("drop-revealed-card");
      let button = face.firstElementChild;
      if (!button) {
        button = cardButton(card, false, false, null, "");
        face.append(button);
      }
      button.tabIndex = 0;
      button.onclick = () => openDropCollection(cards, card);
      el("drop-portal").removeAttribute("aria-hidden");
    } else {
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
    }
    el("drop-title").textContent = dropSession?.crafted ? "Карта создана!"
      : single ? "Карта получена!" : `Получено карт: ${cards.length}`;
    el("drop-rarity").textContent = single ? cards[0].rarity_title : "";
    el("drop-description").textContent = single ? "Карта сохранена в коллекции." : "Карты сохранены в коллекции.";
    el("drop-skip").hidden = true;
    el("drop-close").hidden = false;
    el("drop-followup").hidden = false;
    el("drop-dust").hidden = !single || Boolean(dropSession?.gift || dropSession?.first || dropSession?.crafted);
    el("drop-to-collection").onclick = () => openDropCollection(cards, null);
    if (single) el("drop-dust").textContent = `Распылить за ${cards[0].dust_value} пыли`;
    el("drop-close").focus({ preventScroll: true });
    haptic("success");
  }

  function openDropCollection(cards, card) {
    closeDropOpening();
    state.receivedCards = cards;
    state.collectionMode = "cards";
    state.collectionSelected.clear();
    state.selectMode = false;
    state.collectionVisited = false;
    showPage("collection");
    el("collection-received").scrollIntoView({ block: "start" });
    if (card) openCardSheet(card, { source: cards });
  }

  async function playDropReveal(cards) {
    const session = dropSession;
    clearTimeout(state.dropStageTimer);
    if (!session || session.cancelled) return;
    if (!dropMotion.matches && !document.hidden) {
      const delay = session.crafted ? 220 : DROP_MIN_OPEN_MS;
      await dropWait(session, Math.max(0, delay - (performance.now() - state.dropStartedAt)));
      if (!document.hidden && !session.skipped && !session.cancelled) {
        if (cards.length > 1) await revealDropSequence(cards, session);
        else await revealDrop(cards[0], session);
      }
    }
    if (!session.cancelled) showDropResults(cards);
  }

  async function presentDrop(result, isFreeDrop) {
    setBalance(result.balance);
    if (Number.isInteger(result.crystals)) setCrystals(result.crystals);
    if (Number.isInteger(result.rolls)) setRolls(result.rolls);
    if (isFreeDrop && state.profile) {
      state.profile.free_drops = result.free_drops;
      state.profile.drop_cooldown = result.drop_cooldown;
      state.dropReadyAt = Date.now() + (result.free_drops.next_in || 0) * 1000;
    }
    const cards = result.cards || [result.card];
    if (state.profile && !dropSession?.crafted) state.profile.has_summoned = true;
    state.collectionVisited = false;
    state.ownedCardCount += cards.length;
    el("card-count").textContent = state.ownedCardCount;
    await playDropReveal(cards);
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
    dropSession.first = !state.profile?.has_summoned && !state.ownedCardCount;
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
    updateCollectionAvailability();
    container.classList.toggle("compact-collection", Boolean(state.compactCollection));
    el("collection-layout").setAttribute("aria-pressed", String(Boolean(state.compactCollection)));
    el("collection-layout").textContent = state.compactCollection ? "Крупная сетка" : "Компактный список";
    el("collection-count").textContent = formatCardCount(state.collectionTotal);
    el("collection-page-label").textContent =
      state.collectionPages > 1 ? `${state.collectionPage} / ${state.collectionPages}` : "";
    if (!state.collectionItems.length) {
      container.replaceChildren();
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.gridColumn = "1 / -1";
      const filtered = state.collectionQuery || state.collectionRarity || state.collectionFilter === "special_numbers";
      empty.textContent = filtered ? "Карты не найдены. Измените поиск или сбросьте фильтры."
        : state.collectionFilter === "favorites" ? "Избранных карт пока нет. Откройте карту и нажмите звёздочку."
        : state.collectionFilter === "recent" ? "За последние 7 дней новых карт нет."
        : "Коллекция пока пуста. Откройте первую карту на главной.";
      if (filtered) {
        empty.append(displayButton("Сбросить поиск и фильтры", () => el("collection-reset").click()));
      } else if (!state.collectionFilter) {
        empty.append(displayButton("На главную", () => showPage("home")));
      }
      container.append(empty);
      return;
    }
    container.replaceChildren();
    state.collectionItems.forEach((card) => {
      const selected = state.collectionSelected.has(card.id);
      const open = (event) => {
        if (card.lock_reason && (event.longPress || state.selectMode)) {
          openCardSheet(card, { source: inventoryDetailSource() });
          return;
        }
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
        openCardSheet(card, { source: inventoryDetailSource() });
      };
      const button = cardButton(card, selected, Boolean(card.lock_reason), open, "");
      button.dataset.collectionCard = card.id;
      if (!state.compactCollection) {
        if (card.owned_count > 1) {
          const copies = document.createElement("span");
          copies.className = "mark-pill card-copy-count";
          copies.textContent = `×${card.owned_count}`;
          button.setAttribute("aria-label", `${button.getAttribute("aria-label")}, экземпляров: ${card.owned_count}`);
          copies.setAttribute("aria-hidden", "true");
          button.append(copies);
        }
        container.append(button);
        return;
      }
      const row = document.createElement("div");
      row.className = "compact-card";
      row.classList.toggle("selected", selected);
      const description = document.createElement("button");
      description.className = "compact-card-description";
      description.type = "button";
      const label = document.createElement("strong");
      label.textContent = card.name;
      const details = document.createElement("span");
      details.textContent = `${card.rarity_title} · Всего: ${card.owned_count ?? 1}`;
      description.append(label, details, printNumberLabel(card));
      description.addEventListener("click", open);
      row.append(button, description);
      container.append(row);
    });
  }

  function inventoryDetailSource() {
    const items = state.collectionItems;
    const next = state.collectionPage < state.collectionPages ? async () => {
      await loadCollection(state.collectionPage + 1);
      const card = state.collectionItems[items.length];
      return card && { card, source: inventoryDetailSource() };
    } : null;
    return { items, next };
  }

  async function loadCollection(page = 1, reset = false) {
    if (state.collectionLoading && !reset) return;
    const version = ++state.collectionVersion;
    state.collectionLoading = true;
    el("collection-more").disabled = true;
    if (reset) {
      loadedCollectionModes.delete("cards");
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
      include_counts: "1",
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
      loadedCollectionModes.add("cards");
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
    const duplicateMode = state.collectionMode === "duplicates";
    const count = duplicateMode ? copies.selected.size : cards.length;
    bar.hidden = state.activePage !== "collection" ||
      !(duplicateMode ? count > 0 : state.collectionMode === "cards" && state.selectMode);
    el("select-review").textContent = `Распылить · Выбрано ${count}`;
    el("select-review").disabled = count === 0 || copies.busy;
    bar.querySelectorAll("[data-select-action]").forEach((button) => { button.hidden = duplicateMode; });
  }

  function updateCollectionAvailability() {
    const empty = Boolean(state.profile) && state.ownedCardCount === 0;
    el("collection-empty").hidden = !empty;
    el("collection-browse").hidden = empty;
  }

  function refreshCollection({ reuse = false } = {}) {
    state.collectionVisited = true;
    const mode = state.collectionMode;
    el("collection-catalog").hidden = mode !== "cards";
    el("collection-albums").hidden = mode !== "albums";
    el("collection-duplicates").hidden = mode !== "duplicates";
    el("collection-frames").hidden = mode !== "frames";
    document.querySelectorAll("[data-collection-mode]").forEach((button) => {
      const active = button.dataset.collectionMode === mode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (!reuse) loadedCollectionModes.clear();
    syncBackButton();
    renderCollectionSelection();
    if (mode === "albums" && !loadedCollectionModes.has(mode)) return loadCollectionAlbums(albums.page).catch(showError);
    if (mode === "duplicates" && !loadedCollectionModes.has(mode)) return loadCollectionCopies(copies.page).catch(showError);
    if (mode === "frames") return loadFrameInventory();
    if (mode === "cards") {
      updateCollectionAvailability();
      renderReceivedCards();
      renderCollectionFilters();
      if (!loadedCollectionModes.has(mode)) return reloadCatalog();
    }
    return Promise.resolve();
  }

  function setCollectionMode(mode) {
    if (mode === state.collectionMode) return;
    if (state.activePage === "collection") pagePositions.set(`collection:${state.collectionMode}`, window.scrollY);
    state.collectionMode = mode;
    if (state.selectMode || state.collectionSelected.size) clearCollectionSelection();
    refreshCollection({ reuse: true }).then(() => {
      if (state.activePage === "collection" && state.collectionMode === mode) {
        window.scrollTo(0, pagePositions.get(`collection:${mode}`) || 0);
      }
    });
    rememberCollectionSettings();
  }

  function renderReceivedCards() {
    el("collection-received").hidden = !state.receivedCards.length;
    el("collection-received-cards").replaceChildren(...state.receivedCards.map((card) =>
      cardButton(card, false, Boolean(card.lock_reason), () => openCardSheet(card, { source: state.receivedCards }), "")));
  }

  function clearCollectionSelection() {
    state.collectionSelected.clear();
    state.selectMode = false;
    renderCollectionSelection();
  }

  function reloadCatalog() {
    clearTimeout(state.collectionSearchTimer);
    return loadCollection(1, true).catch(showError);
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
    const summary = el("collection-filter-summary");
    const label = ["Фильтры и сортировка", rarity, sort].filter(Boolean).join(" · ");
    summary.setAttribute("aria-label", label);
    summary.title = label;
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

  function pagedDetailSource(items, data, loadPage, firstPage = 1) {
    const turnPage = (direction) => async () => {
      const source = await loadPage(data.page + direction);
      const card = source?.items.at(direction > 0 ? 0 : -1);
      return card && { card, source };
    };
    return { items, prev: data.page > firstPage ? turnPage(-1) : null,
      next: data.page < data.pages ? turnPage(1) : null };
  }

  async function loadCollectionAlbums(page) {
    const version = ++albums.version;
    const series = albums.series;
    loadedCollectionModes.delete("albums");
    const list = el("collection-album-items");
    const status = el("collection-album-status");
    el("collection-album-title").textContent = series ?? "Альбомы по сериям";
    el("collection-album-back").hidden = series === null;
    syncBackButton();
    el("collection-album-links").hidden = series !== null;
    const filter = el("album-favorites-filter");
    filter.hidden = series !== null;
    filter.setAttribute("aria-pressed", String(albums.favorites));
    const reward = el("album-reward");
    reward.hidden = true;
    reward.replaceChildren();
    el("collection-album-pages").hidden = true;
    status.textContent = "Загружаем альбомы…";
    list.replaceChildren();
    const params = new URLSearchParams({ page: String(page) });
    if (series !== null) params.set("series", series);
      else if (albums.favorites) params.set("favorites", "1");
    try {
      const data = await api(`/api/collection/albums?${params}`);
      if (version !== albums.version) return;
      albums.page = data.page;
      let detailSource = null;
      if (series === null) {
        status.textContent = data.total ? "" : albums.favorites ? "Пока нет избранных альбомов."
          : "Альбом появится после получения первой карты из серии.";
        for (const item of data.items) {
          const row = collectionRow(item.series, `Собрано ${item.owned} из ${item.total}`, () => {
            albums.listPage = albums.page;
            albums.listScroll = window.scrollY;
            albums.series = item.series;
            window.scrollTo(0, 0);
            loadCollectionAlbums(1).catch(showError);
          });
          const progress = document.createElement("progress");
          progress.value = item.owned;
          progress.max = item.total;
          progress.setAttribute("aria-hidden", "true");
          row.append(progress);
          const favorite = displayButton(item.favorite ? "★" : "☆", async () => {
            favorite.disabled = true;
            try {
              const result = await api("/api/collection/albums/favorite", {
                method: "POST", body: JSON.stringify({ series: item.series, favorite: !item.favorite }),
              });
              item.favorite = result.favorite;
              if (version !== albums.version) return;
              if (albums.favorites) await loadCollectionAlbums(data.page);
              else updateFavorite();
            } finally { favorite.disabled = false; }
          });
          favorite.classList.add("album-favorite");
          const updateFavorite = () => {
            favorite.textContent = item.favorite ? "★" : "☆";
            favorite.setAttribute("aria-pressed", String(Boolean(item.favorite)));
            favorite.setAttribute("aria-label", `Избранный альбом: ${item.series}`);
          };
          updateFavorite();
          const entry = document.createElement("div");
          entry.className = "album-list-entry";
          entry.append(row, favorite);
          list.append(entry);
        }
      } else {
        status.textContent = `Собрано ${data.owned} из ${data.total} · не хватает: ${data.total - data.owned}`;
        if (data.total) {
          const label = document.createElement("strong");
          label.textContent = data.claimed ? `Награда получена · ${data.reward} пыли`
            : `Награда за сбор · ${data.reward} пыли`;
          reward.append(label);
          if (!data.claimed && data.owned === data.total) {
            const claim = displayButton("Забрать награду", async () => {
              claim.disabled = true;
              try {
                const result = await api("/api/collection/albums/claim", {
                  method: "POST", body: JSON.stringify({ series }),
                });
                setBalance(result.balance);
                showNotice(`Награда за альбом: +${result.amount} пыли.`);
                if (version === albums.version) await loadCollectionAlbums(data.page);
              } finally { claim.disabled = false; }
            }, false);
            reward.append(claim);
          }
          reward.hidden = false;
        }
        const source = pagedDetailSource(data.items.map((item) => item.card).filter(Boolean),
          data, loadCollectionAlbums, data.first_owned_page);
        detailSource = source;
        for (const item of data.items) {
          const { name, card, craft_price: price } = item;
          const details = card ? `В коллекции · ${card.rarity_title}`
            : price ? `Ещё не получена · создание за ${price} пыли` : "Ещё не получена";
          const row = collectionRow(name, details, card
            ? () => openCardSheet(card, { source }) : () => openMissingAlbumCard(item));
          if (card) row.dataset.collectionCard = card.id;
          list.append(row);
        }
      }
      renderCollectionPages("collection-album-pages", data);
      loadedCollectionModes.add("albums");
      rememberCollectionSettings();
      return detailSource;
    } catch (error) {
      if (version !== albums.version) return;
      status.textContent = "Не удалось загрузить альбомы.";
      list.append(displayButton("Повторить", () => loadCollectionAlbums(page)));
      throw error;
    }
  }

  function openMissingAlbumCard(item) {
    const body = document.createElement("div");
    body.className = "wallet-actions";
    body.append(displayButton("Найти на Маркете", () => {
      resetMarketFilters(item.name);
      state.marketTab = "all";
      closeSheet();
      showPage("trade");
      if (state.tradeToken) setMarketTab("all");
      window.scrollTo(0, 0);
    }, false));
    if (item.craft_price) {
      body.append(displayButton(`К созданию · ${item.craft_price} пыли`, () => {
        closeSheet();
        showPage("crystals", { loadShop: false });
        setShopTab("craft");
        window.scrollTo(0, 0);
        openCraftSearch(item.craft_rarity, item.name);
      }));
    }
    openSheet(item.name, body);
  }

  function updateCopySelection() {
    const value = [...copies.selected.values()].reduce((total, card) => total + card.dust_value, 0);
    el("collection-copy-selection").textContent = `Выбрано: ${copies.selected.size} · Получите ${value} пыли`;
    el("collection-copy-review").disabled = !copies.selected.size || copies.busy;
    renderCollectionSelection();
  }

  async function loadCollectionCopies(page) {
    const version = ++copies.version;
    loadedCollectionModes.delete("duplicates");
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
      const source = pagedDetailSource(data.items, data, loadCollectionCopies);
      status.textContent = data.total ? `Доступно для распыления: ${data.total}` : "Нет копий для безопасного распыления.";
      const rows = data.items.map((card) => {
        const label = document.createElement("label");
        label.className = "collection-copy";
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.copyId = card.id;
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
        const row = document.createElement("div");
        row.className = "copy-entry";
        row.dataset.collectionCard = card.id;
        row.append(label, displayButton("Детали", () => openCardSheet(card, { source })));
        return row;
      });
      list.append(...rows);
      el("collection-copy-actions").hidden = !data.total;
      renderCollectionPages("collection-copy-pages", data);
      loadedCollectionModes.add("duplicates");
      rememberCollectionSettings();
      updateCopySelection();
      return source;
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
    const body = document.createElement("div");
    body.className = "collection-list";
    for (const card of cards) {
      const remain = card.owned_count - cards.filter((item) => item.character_id === card.character_id).length;
      body.append(selectionReviewRow(card, `Останется: ${remain}`, () => {
        copies.selected.delete(card.id);
        const checkbox = el("collection-copy-items").querySelector(`[data-copy-id="${card.id}"]`);
        if (checkbox) checkbox.checked = false;
        updateCopySelection();
        if (copies.selected.size) reviewCollectionCopies();
        else closeSheet();
      }));
    }
    const warning = document.createElement("p");
    warning.className = "hint";
    warning.textContent = "Действие нельзя отменить.";
    const cancel = displayButton("Вернуться к выбору", closeSheet);
    const confirm = displayButton(`Распылить · ${formatCardCount(cards.length)}`, async () => {
      if (copies.busy) return;
      copies.busy = true;
      confirm.disabled = true;
      cancel.disabled = true;
      updateCopySelection();
      let succeeded = false;
      try {
        const result = await api("/api/dust/duplicates", {
          method: "POST", body: JSON.stringify({ card_ids: cards.map(({ id }) => id), estimate }),
        });
        removeDustedCards(result);
        succeeded = true;
        showNotice(`Распылено карт: ${result.card_ids.length}. Получено ${result.amount} пыли.`);
        haptic("success");
      } catch (error) { showError(error); }
      finally {
        copies.busy = false;
        if (succeeded) {
          copies.selected.clear();
          if (body.isConnected && !el("sheet").hidden) closeSheet();
          if (state.activePage === "collection") refreshCollection();
        }
        updateCopySelection();
        confirm.disabled = false;
        cancel.disabled = false;
      }
    });
    confirm.className = "btn btn-danger btn-block";
    const reward = document.createElement("strong");
    reward.className = "dust-review-reward";
    reward.textContent = `+${estimate} пыли`;
    body.prepend(confirm, reward, warning);
    body.append(cancel);
    openSheet("Проверьте распыление", body);
  }

  function selectionReviewRow(card, detail, remove) {
    const row = document.createElement("div");
    row.className = "copy-entry";
    row.append(collectionRow(card.name, [formatPrintNumber(card), detail].filter(Boolean).join(" · ")));
    const button = displayButton("Убрать", remove);
    button.setAttribute("aria-label", `Убрать ${card.name} ${formatPrintNumber(card)}`);
    row.append(button);
    return row;
  }

  function reviewSelectedCards() {
    const cards = [...state.collectionSelected.values()];
    if (!cards.length) return;
    const body = document.createElement("div");
    body.className = "collection-list";
    const summary = document.createElement("p");
    summary.className = "hint";
    summary.setAttribute("role", "status");
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.textContent = "Распылить";
    confirm.className = "btn btn-danger btn-block";
    const reward = document.createElement("strong");
    reward.className = "dust-review-reward";
    reward.hidden = true;
    body.append(confirm, reward, summary);
    let estimate;
    let submitting = false;
    const rows = new Map();
    const cleanup = displayButton("Оставить только доступные", () => {
      if (submitting) return;
      for (const card of cards) {
        if (!availableIds.has(card.id)) state.collectionSelected.delete(card.id);
      }
      renderCollectionSelection();
      renderCollection();
      if (state.collectionSelected.size) reviewSelectedCards();
      else closeSheet();
    });
    cleanup.hidden = true;
    let availableIds = new Set();
    for (const card of cards) {
      const row = selectionReviewRow(card, "", () => {
        if (submitting) return;
        state.collectionSelected.delete(card.id);
        renderCollectionSelection();
        renderCollection();
        if (state.collectionSelected.size) reviewSelectedCards();
        else closeSheet();
      });
      rows.set(card.id, row);
      body.append(row);
    }
    const cancel = displayButton("Вернуться к выбору", () => { if (!submitting) closeSheet(); });
    body.append(cleanup, cancel);
    confirm.addEventListener("click", async () => {
      if (confirm.disabled) return;
      submitting = true;
      body.querySelectorAll("button").forEach((button) => { button.disabled = true; });
      try {
        if (await dustSelected(estimate)) {
          if (body.isConnected) closeSheet();
        } else if (body.isConnected) {
          await load();
        }
      } finally {
        submitting = false;
        rows.forEach((row) => { row.querySelector("button").disabled = false; });
        cleanup.disabled = false;
        cancel.disabled = false;
      }
    });
    const load = async () => {
      confirm.disabled = true;
      reward.hidden = true;
      summary.textContent = "Проверяем карты…";
      try {
        const result = await api(`/api/dust/preview?cards=${cards.map((card) => card.id).join(",")}`);
        if (!body.isConnected) return;
        const blocked = new Map(result.protected.map((id) => [id, "Защищена от распыления"]));
        availableIds = new Set(cards.filter((card) => !blocked.has(card.id)).map((card) => card.id));
        cards.forEach((card) => {
          const details = rows.get(card.id).querySelector(".hint");
          details.textContent = [formatPrintNumber(card), blocked.get(card.id) ||
            `Останется: ${result.remaining[card.character_id]}`].filter(Boolean).join(" · ");
        });
        estimate = result.amount;
        reward.textContent = `+${estimate} пыли`;
        reward.hidden = Boolean(blocked.size);
        summary.textContent = blocked.size ? `Недоступно: ${blocked.size}. ${availableIds.size
          ? "Нажмите «Оставить только доступные», чтобы убрать их из выбора."
          : "Измените выбор карт."}`
          : [dustLossWarning(cards, result.remaining), "Действие нельзя отменить."].filter(Boolean).join(" ");
        cleanup.hidden = !blocked.size || !availableIds.size;
        confirm.textContent = blocked.size ? "Распыление недоступно" : `Распылить · ${formatCardCount(cards.length)}`;
        confirm.disabled = Boolean(blocked.size);
      } catch (error) {
        if (body.isConnected) summary.replaceChildren(displayButton("Повторить расчёт", load));
        showError(error);
      }
    };
    openSheet("Проверьте распыление", body);
    load();
  }

  function dustLossWarning(cards, remaining) {
    const warnings = [];
    if (Object.values(remaining).some((count) => count === 0)) warnings.push("Среди выбранных есть последние экземпляры.");
    if (cards.some((card) => card.frame_style && card.frame_style !== "classic")) warnings.push("Закреплённые коллекционные рамки исчезнут.");
    if (cards.some((card) => card.upgrade_level > 0)) warnings.push("Улучшения исчезнут без возврата пыли.");
    return warnings.join(" ");
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
    sheetBack = null;
    el("sheet").classList.remove("sheet--card");
    el("sheet").hidden = true;
    el("sheet-backdrop").hidden = true;
    clearMainButton();
    syncBackButton();
    if (detailAnchor && state.activePage === "collection") {
      for (const anchor of el("collection-page").querySelectorAll(`[data-collection-card="${detailAnchor}"]`)) {
        if (anchor.getClientRects().length) {
          anchor.scrollIntoView({ block: "nearest" });
          break;
        }
      }
    }
    detailAnchor = null;
    sheetReturnFocus?.focus({ preventScroll: true });
    sheetReturnFocus = null;
  }
  function backFromSheet() {
    if (sheetBack) sheetBack();
    else closeSheet();
  }
  function openSheet(title, body, main, back = null) {
    sheetBack = back;
    sheetReturnFocus = null;
    el("toast").classList.remove("show");
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

  function renderCardInspection(card, previousImageUrl) {
    const preview = cardButton(card, false, false, null, "", previousImageUrl, true);
    preview.classList.add("sheet-card");
    preview.tabIndex = -1;
    preview.setAttribute("aria-disabled", "true");
    const presentation = document.createElement("div");
    presentation.className = "card-inspect-visual";
    presentation.append(preview);
    return presentation;
  }

  function openCardSheet(card, { revealUpgrade = false, previousImageUrl, upgradeMask, source } = {}) {
    if (!revealUpgrade) haptic("light");
    detailAnchor = state.activePage === "collection" ? card.id : null;
    const body = document.createElement("div");
    body.className = "card-detail-content";
    const presentation = renderCardInspection(card, previousImageUrl);
    body.classList.toggle("card-upgrade-complete", revealUpgrade);
    upgradeMask?.then((url) => {
      if (!url || !presentation.isConnected || el("sheet").hidden) return;
      const effect = document.createElement("span");
      effect.className = "card-upgrade-effect";
      effect.dataset.level = card.upgrade_level;
      effect.setAttribute("aria-hidden", "true");
      effect.style.setProperty("--upgrade-mask", `url("${url}")`);
      effect.addEventListener("animationend", () => effect.remove(), { once: true });
      presentation.querySelector("img").after(effect);
    });
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
    const lockStatus = document.createElement("div");
    lockStatus.className = "card-lock-status";
    if (card.lock_reason) showCardLock(card, lockStatus, source);
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
      ["Предложить обмен", "secondary", () => withFirstTip("trade", "Первый обмен",
        "Получатель предложит свои карты. Обмен завершится после вашего подтверждения нового набора.", () => {
        if (state.tradeToken) {
          showNotice("Завершите текущий обмен, чтобы создать новое предложение.");
          return;
        }
        state.selected = new Map([[card.id, card]]);
        state.marketTab = "trade";
        closeSheet();
        showPage("trade");
      })],
      ["Передать", "secondary", () => openTransferComposer([card], () => openCardSheet(card, { source }))],
      [`Распылить за ${card.dust_value} пыли`, "danger", () => withFirstTip("dust", "Первое распыление",
        "Карта исчезнет из коллекции, а пыль поступит в кошелёк. Действие потребует подтверждения.", async () => {
        state.collectionSelected = new Map([[card.id, card]]);
        reviewSelectedCards();
      })],
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
      const missing = Math.max(0, upgradePrice - state.balance);
      if (missing) upgrade.textContent += ` · не хватает ${missing}`;
      upgrade.disabled = Boolean(card.lock_reason);
      upgrade.addEventListener("click", () => {
        if (state.balance < upgradePrice) {
          openWallet("dust", { missing: upgradePrice - state.balance, onBack: () => openCardSheet(card, { source }) });
        } else upgradeCard(card, upgrade, upgradePrice, source);
      });
      actions.append(upgrade);
    }
    const refund = state.profile?.economy?.upgrade_refunds?.[level - 1];
    if (refund !== undefined) {
      const remove = displayButton(`Снять уровень · +${refund} пыли`, () => downgradeCard(card, remove, refund, source));
      remove.disabled = Boolean(card.lock_reason);
      actions.append(remove);
    }
    const manageFrame = document.createElement("button");
    manageFrame.type = "button";
    manageFrame.className = "btn btn-secondary btn-block card-frame-manage";
    manageFrame.textContent = hasCustomFrame(card) ? "Сменить или снять рамку" : "Надеть рамку";
    manageFrame.disabled = Boolean(card.lock_reason);
    manageFrame.addEventListener("click", () => withFirstTip("frame", "Первая примерка",
      "Здесь можно примерить свои рамки. Если передать карту с коллекционной рамкой, она уйдёт вместе с картой.",
      () => openFramePicker(card, { onBack: (updated) => openCardSheet(updated, { source }) })));
    body.append(presentation);
    const items = Array.isArray(source) ? source : source?.items;
    if (items && (items.length > 1 || source.prev || source.next)) {
      const index = items.findIndex((item) => item.id === card.id);
      let loading = false;
      const move = async (direction) => {
        if (loading) return;
        const next = items[index + direction];
        if (next) {
          openCardSheet(state.collectionItems.find((item) => item.id === next.id) || next, { source });
          return;
        }
        const load = direction < 0 ? source.prev : source.next;
        if (!load) return;
        loading = nav.inert = true;
        try {
          const result = await load();
          if (result && body.isConnected && !el("sheet").hidden) {
            openCardSheet(result.card, { source: result.source });
          }
        } finally { loading = nav.inert = false; }
      };
      const nav = document.createElement("nav");
      nav.className = "card-detail-nav";
      const prev = displayButton("←", () => move(-1));
      const next = displayButton("→", () => move(1));
      prev.setAttribute("aria-label", "Предыдущая карта");
      next.setAttribute("aria-label", "Следующая карта");
      prev.disabled = index <= 0 && !source.prev;
      next.disabled = index >= items.length - 1 && !source.next;
      const count = document.createElement("span");
      count.textContent = `${index + 1} / ${items.length}`;
      nav.append(prev, count, next);
      body.append(nav);
      let start;
      body.classList.add("card-detail-swipable");
      body.addEventListener("touchstart", ({ touches }) => {
        start = touches.length === 1 ? [touches[0].clientX, touches[0].clientY] : null;
      }, { passive: true });
      body.addEventListener("touchend", ({ changedTouches }) => {
        if (!start || changedTouches.length !== 1) return;
        const dx = changedTouches[0].clientX - start[0];
        const dy = changedTouches[0].clientY - start[1];
        start = null;
        if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) move(dx < 0 ? 1 : -1).catch(showError);
      }, { passive: true });
    }
    body.append(printNumberLabel(card), frameStatus, lockStatus, manageFrame, actions, more);
    openSheet(card.name, body);
    el("sheet").classList.add("sheet--card");
  }

  function showCardLock(card, container, source) {
    const load = async () => {
      try {
        const { card: updated, lock } = await api(`/api/cards/${card.id}`);
        if (!container.isConnected || el("sheet").hidden) return;
        if (!lock && !updated.lock_reason) {
          applyCardUpdate(updated);
          openCardSheet(updated, { source });
          return;
        }
        if (!lock) return;
        const typeNames = { listing: "Аукцион", gift: "Подарок", trade: "Обмен", transfer: "Передача" };
        const name = typeNames[lock.type];
        const title = document.createElement("p");
        title.className = "hint";
        title.textContent = `${name} #${lock.id} · до ${localDateTime(lock.expires_at)}`;
        if (lock.type === "listing") {
          container.replaceChildren(title, displayButton("Открыть лот", async () => {
            const { listing } = await api(`/api/market/${lock.id}`);
            openSheet(`Аукцион #${lock.id}`, listingCard({ ...listing, can_cancel: !listing.bid_count }, { mine: listing.status === "active" }),
              null, () => openCardSheet(card, { source }));
          }));
          return;
        }
        const cancel = displayButton(`Отменить · ${name.toLowerCase()} #${lock.id}`, async () => {
          if (cancel.disabled) return;
          cancel.disabled = true;
          try {
            if (!await confirmAction(`Отменить сделку #${lock.id} и освободить карты?`)) return;
            await api(`/api/${lock.type === "trade" ? "trades" : "transfers"}/${lock.id}`, { method: "DELETE" });
            await load();
            if (state.activePage === "collection") refreshCollection();
            showNotice("Сделка отменена.");
          } finally { cancel.disabled = false; }
        });
        container.replaceChildren(title, cancel);
      } catch (error) {
        if (!container.isConnected || el("sheet").hidden) return;
        container.replaceChildren(displayButton("Повторить проверку блокировки", load));
        showError(error);
      }
    };
    load();
  }

  async function loadFramesCatalog() {
    const shop = await api("/api/frames");
    state.shopFrames = shop.items;
    state.framePacks = shop.packs;
    state.frameRecycle = shop.recycle;
    setCrystals(shop.crystals);
    setBalance(shop.balance);
    return state.shopFrames;
  }

  let frameInventoryVersion = 0;

  async function loadFrameInventory() {
    const version = ++frameInventoryVersion;
    const status = el("frame-inventory-status");
    status.textContent = "Загружаем ваши рамки…";
    el("frame-inventory-items").replaceChildren();
    el("frame-inventory-count").textContent = "";
    el("frame-inventory-available").disabled = true;
    try {
      const frames = await loadFramesCatalog();
      if (version !== frameInventoryVersion) return;
      renderFrameInventory(frames);
    } catch (error) {
      if (version !== frameInventoryVersion) return;
      status.replaceChildren(displayButton("Повторить загрузку", loadFrameInventory));
      showError(error);
    }
  }

  function renderFrameInventory(frames = state.shopFrames) {
    const owned = frames.filter((frame) => frame.owned);
    const available = el("frame-inventory-available");
    available.disabled = !owned.length;
    const visible = available.checked ? owned.filter((frame) => frame.available) : owned;
    el("frame-inventory-count").textContent = `Всего: ${owned.reduce((sum, frame) => sum + frame.quantity, 0)}`;
    const status = el("frame-inventory-status");
    status.textContent = visible.length ? "" : owned.length ? "Все рамки надеты." : "В инвентаре пока нет рамок.";
    if (!owned.length) status.append(" ", displayButton("В магазин рамок", () => {
      showPage("crystals", { loadShop: false });
      setShopTab("frames");
      window.scrollTo(0, 0);
    }));
    el("frame-inventory-items").replaceChildren(...visible.map((frame) =>
      rewardTile(frame.title, frameAssetUrl(frame.preview_url),
        `${frame.rarity_title} · ×${frame.quantity}`, frameStockLabel(frame), () => {
          const body = document.createElement("div");
          body.className = "reward-detail";
          const stock = document.createElement("p");
          stock.className = "hint";
          stock.textContent = `${frame.rarity_title} · Всего: ${frame.quantity} · ${frameStockLabel(frame)}`;
          body.append(rewardVisual(frameAssetUrl(frame.live_preview_url || frame.preview_url), frame), stock,
            displayButton("Примерить на карте", () => previewFrameOnCard(frame.id, owned, "Мои рамки")));
          if (frame.pack_id && frame.rarity === "rare" && !frame.case_only
              && frame.quantity > 1 && frame.available > 0 && state.frameRecycle) {
            const limit = state.frameRecycle;
            if (limit.remaining) {
              body.append(displayButton("Распылить лишнюю рамку", () => confirmFrameRecycle(frame)));
            } else {
              const note = document.createElement("p");
              note.className = "hint";
              note.textContent = `Лимит распыления исчерпан до ${localDateTime(limit.resets_at)}.`;
              body.append(note);
            }
          }
          openSheet(frame.title, body);
        })));
  }

  function confirmFrameRecycle(frame) {
    const body = document.createElement("div");
    body.className = "wallet-actions";
    const reward = document.createElement("strong");
    reward.className = "dust-review-reward";
    reward.textContent = "+1 кристалл";
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = `Будет распылён один свободный экземпляр «${frame.title}». Осталось распылений на этой неделе: ${state.frameRecycle.remaining}.`;
    const confirm = displayButton("Распылить", async () => {
      if (confirm.disabled) return;
      confirm.disabled = true;
      try {
        const result = await api("/api/frames/recycle", {
          method: "POST", body: JSON.stringify({ frame_id: frame.id }),
        });
        setCrystals(result.crystals);
        if (body.isConnected) closeSheet();
        showNotice("Получен 1 кристалл.");
        if (state.activePage === "collection" && state.collectionMode === "frames") await loadFrameInventory();
      } finally { confirm.disabled = false; }
    });
    confirm.className = "btn btn-danger btn-block";
    body.append(confirm, reward, note, displayButton("Отмена", closeSheet));
    openSheet("Распыление рамки", body);
  }

  el("frame-inventory-available").addEventListener("change", () => renderFrameInventory());

  function applyCardUpdate(updated) {
    const replace = (items) => items.map((item) => item.id === updated.id ? updated : item);
    state.collectionItems = replace(state.collectionItems);
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
        el("frame-shop-try").click();
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
    openSheet(`Рамка · ${card.name}`, body, null, () => onBack(card));

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
        const fx = frameEffects(frame.effect, card.rarity, frame.rarity, frame.accent, frame.ornament_url, frame.style, frame.motion_url);
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

  function openBidSheet(listing, enteredAmount = listing.minimum_bid, failure = "") {
    const body = document.createElement("div");
    body.className = "bid-form";
    const balance = document.createElement("p");
    balance.className = "hint";
    const available = state.balance + (listing.highest_bidder_is_me ? listing.current_bid : 0);
    balance.textContent = `Доступно: ${available} пыли · минимум ${listing.minimum_bid}`;
    const input = document.createElement("input");
    input.className = "field";
    input.type = "number";
    input.min = listing.minimum_bid;
    input.value = enteredAmount;
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
      if (local.disabled) return;
      const bidAmount = Number(input.value);
      if (!Number.isSafeInteger(bidAmount) || bidAmount < listing.minimum_bid) {
        showError(new Error(`Минимальная следующая ставка — ${listing.minimum_bid} пыли.`));
        return;
      }
      if (bidAmount > available) {
        openInfoPopup("Недостаточно пыли", `Не хватает ${bidAmount - available} пыли для этой ставки.`);
        return;
      }
      local.disabled = true;
      try {
        if (!await confirmAction(
          `Поставить ${bidAmount} пыли? Сумма будет зарезервирована до конца аукциона.`)) return;
        const result = await api(`/api/market/${listing.id}/bid`, {
          method: "POST",
          body: JSON.stringify({ amount: bidAmount }),
        });
        setBalance(result.balance);
        closeSheet();
        showNotice(`Ставка ${bidAmount} пыли принята.`);
        haptic("success");
        loadMarket().catch(showError);
      } catch (error) {
        try {
          const updated = await api(`/api/market/${listing.id}`);
          if (!body.isConnected || el("sheet").hidden) return;
          setBalance(updated.balance);
          if (updated.listing.status === "active") openBidSheet(updated.listing, input.value, error.message);
          else openSheet(`Аукцион #${listing.id}`, listingCard(updated.listing));
          loadMarket().catch(showError);
        } catch (_refreshError) { showError(error); }
      } finally { local.disabled = false; }
    };
    const local = document.createElement("button");
    local.type = "button";
    local.className = "btn btn-primary btn-block";
    local.textContent = "Подтвердить ставку";
    local.addEventListener("click", submit);
    body.append(balance, row, input, local);
    if (failure) {
      const notice = document.createElement("p");
      notice.className = "hint";
      notice.setAttribute("role", "alert");
      notice.textContent = failure;
      body.append(notice);
    }
    openSheet("Ставка", body);
  }

  function listingCard(listing, { mine = false } = {}) {
    const item = document.createElement("article");
    item.className = "listing";
    const active = listing.status === "active";
    if (listing.card && (active || listing.highest_bidder_is_me && state.profile?.id !== listing.seller_id && !listing.viewer_has_bid)) {
      item.append(cardButton(listing.card, false, true, null, ""));
    }
    const body = document.createElement("div");
    body.className = "listing-body";
    const title = document.createElement("strong");
    title.className = "listing-title";
    title.textContent = listing.card?.name || `Лот #${listing.id}`;
    const rarity = document.createElement("span");
    rarity.className = "listing-rarity";
    rarity.textContent = listing.card?.rarity_title || "";
    const time = document.createElement("div");
    time.className = "listing-time";
    if (active) time.dataset.auctionExpiry = String(listing.expires_at);
    else time.textContent = { sold: "Завершён", expired: "Истёк", cancelled: "Отменён" }[listing.status];
    const offer = document.createElement("div");
    offer.className = "listing-offer";
    const current = document.createElement("strong");
    current.className = "listing-price";
    const price = listing.current_bid ?? listing.starting_price;
    const dust = document.createElement("span");
    dust.className = "currency-icon chip-dust";
    dust.setAttribute("aria-hidden", "true");
    current.append(dust, price.toLocaleString("ru-RU"));
    current.setAttribute("aria-label", `${listing.current_bid === null ? "Старт" : "Текущая ставка"}: ${price} пыли`);
    offer.append(current);
    const bids = document.createElement("div");
    bids.className = "listing-meta";
    bids.textContent = `Ставок: ${listing.bid_count}`;
    const details = document.createElement("span");
    details.className = "listing-meta";
    details.textContent = [active ? `Следующая ставка от ${listing.minimum_bid} пыли` : "",
      listing.card && hasCustomFrame(listing.card) ? `Рамка: ${listing.card.style_title}` : ""].filter(Boolean).join(" · ");
    body.append(title);
    if (listing.card) body.append(rarity, printNumberLabel(listing.card));
    body.append(time, bids);
    if (details.textContent) body.append(details);
    if (listing.highest_bidder_is_me || listing.viewer_has_bid) {
      const lead = document.createElement("span");
      lead.className = "lead-badge";
      lead.textContent = listing.highest_bidder_is_me ? (active ? "Вы лидируете" : "Вы выиграли") : "Ставку перебили";
      body.append(lead);
    }
    if (mine) {
      if (listing.can_cancel) {
        const cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "btn btn-danger listing-action";
        cancel.textContent = "Снять";
        cancel.addEventListener("click", async () => {
          try {
            await api(`/api/listings/${listing.id}`, { method: "DELETE" });
            state.collectionVisited = false;
            if (state.activePage === "collection") refreshCollection();
            await loadMyListings();
            showNotice(`Аукцион #${listing.id} отменён.`);
          } catch (error) { showError(error); }
        });
        offer.append(cancel);
      }
    } else if (active) {
      const bid = document.createElement("button");
      bid.type = "button";
      bid.className = "btn btn-primary listing-action";
      bid.textContent = listing.highest_bidder_is_me ? "Повысить" : "Ставка";
      bid.disabled = listing.seller_id === state.profile?.id;
      bid.addEventListener("click", () => openBidSheet(listing));
      offer.append(bid);
    }
    item.append(body, offer);
    return item;
  }

  const marketFilters = () => [...document.querySelectorAll("[data-market-filter]")];
  function resetMarketFilters(query = "") {
    el("market-search").value = query;
    marketFilters().forEach((button) => button.setAttribute("aria-pressed", "false"));
  }

  async function loadMarket(page = 1) {
    const version = state.marketVersion = (state.marketVersion || 0) + 1;
    const container = el("market-cards");
    const more = el("market-more");
    const query = el("market-search").value.trim();
    const params = new URLSearchParams({ page, q: query });
    marketFilters().forEach((button) => {
      if (button.getAttribute("aria-pressed") === "true") params.set(button.dataset.marketFilter, "1");
    });
    more.disabled = true;
    if (page === 1) {
      more.hidden = true;
      container.textContent = "Загружаем лоты…";
    }
    try {
      const data = await api(`/api/market?${params}`);
      if (version !== state.marketVersion) return;
      if (page === 1) {
        state.marketItems = [];
        container.replaceChildren();
      }
      const seen = new Set(state.marketItems.map((listing) => listing.id));
      const items = data.items.filter((listing) => !seen.has(listing.id));
      state.marketItems.push(...items);
      container.append(...items.map((listing) => listingCard(listing)));
      if (!state.marketItems.length) {
        const empty = document.createElement("div");
        empty.className = "empty-state";
        const filtered = query || [...params.keys()].length > 2;
        empty.textContent = filtered ? "По запросу и фильтрам лоты не найдены." : "Активных аукционов пока нет.";
        if (filtered) {
          empty.append(displayButton("Сбросить поиск и фильтры", () => {
            resetMarketFilters();
            return loadMarket();
          }));
        } else {
          empty.append(displayButton("Выбрать карту для аукциона", startAuctionSelection));
        }
        container.append(empty);
      }
      state.marketNextPage = data.next_page;
      more.hidden = !data.next_page;
      updateAuctionCountdowns();
    } catch (error) {
      if (version !== state.marketVersion) return;
      if (page === 1) container.replaceChildren(displayButton("Повторить загрузку лотов", () => loadMarket()));
      throw error;
    } finally {
      if (version === state.marketVersion) more.disabled = false;
    }
  }

  async function loadMyListings() {
    const container = el("my-market-listings");
    let data;
    try { data = await api("/api/listings"); }
    catch (error) {
      container.replaceChildren(displayButton("Повторить загрузку лотов", loadMyListings));
      throw error;
    }
    container.replaceChildren();
    const create = el("create-lot");
    create.hidden = !data.items.length;
    if (create.hidden) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Своих лотов пока нет.";
      empty.append(displayButton(create.textContent, startAuctionSelection));
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
      if (state.tradeToken) {
        render();
        loadTrade().catch(showError);
      }
      else loadInventory().catch(showError);
    }
    if (!initial) haptic("light");
  }

  function renderEconomyStatus() {
    const economy = state.profile?.economy;
    const button = el("dust-ticket-buy");
    button.disabled = !economy || state.economyBusy || !economy.dust_ticket_available;
    const missing = economy ? Math.max(0, economy.dust_ticket_cost - state.balance) : 0;
    button.textContent = !economy ? "Загружаем…" : economy.dust_ticket_available
      ? `Купить билет · ${economy.dust_ticket_cost} пыли${missing ? ` · не хватает ${missing}` : ""}`
      : `Следующая покупка: ${localDateTime(economy.dust_ticket_available_at || state.profile.next_daily_reset)}`;
    el("craft-status").textContent = !economy ? "Загружаем…" : economy.craft_available
      ? `Создание доступно · На балансе ${state.balance} пыли`
      : `Следующее создание: ${localDateTime(economy.craft_available_at)}`;
  }

  async function purchaseDustTicket() {
    if (state.economyBusy || !state.profile?.economy?.dust_ticket_available) return;
    const cost = state.profile.economy.dust_ticket_cost;
    if (state.balance < cost) {
      openWallet("dust", { missing: cost - state.balance, onBack: closeSheet });
      return;
    }
    state.economyBusy = true;
    renderEconomyStatus();
    try {
      if (!await showShopDialog({ title: "Билет за пыль", item: "1 билет",
        description: `Следующая покупка: ${localDateTime(state.profile.next_daily_reset)}.`, art: "ticket",
        price: cost, currency: "dust" })) return;
      const result = await api("/api/rolls/dust", { method: "POST", body: "{}" });
      setBalance(result.balance);
      setRolls(result.rolls);
      state.profile.economy.dust_ticket_available = false;
      showNotice("Билет добавлен. Его можно использовать для открытия карты.");
      haptic("success");
    } catch (error) { showError(error); }
    finally { state.economyBusy = false; renderEconomyStatus(); }
  }

  function renderCraftRarities() {
    const prices = state.profile?.economy?.craft_prices || {};
    el("craft-rarities").replaceChildren(...RARITIES.filter(({ key }) => prices[key] !== undefined).map(({ key, title }) => {
      const button = displayButton(title, () => openCraftSearch(key));
      button.classList.add("craft-rarity-option");
      button.dataset.rarity = key;
      const price = document.createElement("small");
      price.textContent = `${prices[key]} пыли`;
      button.append(price);
      return button;
    }));
  }

  function openCraftSearch(rarity, query = "") {
    const profile = state.profile?.economy;
    const price = profile?.craft_prices?.[rarity];
    if (price === undefined) return;
    const title = RARITIES.find(({ key }) => key === rarity)?.title;
    const body = el("craft-search-template").content.firstElementChild.cloneNode(true);
    const input = body.querySelector("#craft-query");
    const results = body.querySelector("#craft-results");
    const status = body.querySelector("#craft-search-status");
    const next = body.querySelector("#craft-next");
    let version = 0;
    let timer = 0;
    let nextAfter = null;
    const isOpen = () => body.isConnected && !el("sheet").hidden;
    const load = async (after = 0) => {
      if (!isOpen()) return;
      const request = ++version;
      const search = input.value.trim();
      if (!after) results.replaceChildren();
      status.textContent = "Ищем персонажей…";
      next.hidden = true;
      try {
        const data = await api(`/api/craft?${new URLSearchParams({ rarity, q: search, after })}`);
        if (!isOpen() || request !== version) return;
        for (const character of data.items) {
          const button = displayButton(character.name, () => createCharacterCard(character, search));
          button.classList.add("craft-character");
          const series = document.createElement("small");
          series.textContent = character.series;
          button.append(series);
          button.disabled = !state.profile.economy.craft_available;
          results.append(button);
        }
        status.textContent = data.items.length ? (state.profile.economy.craft_available ? "" : el("craft-status").textContent)
          : "Персонажи не найдены.";
        nextAfter = data.next_after;
        next.hidden = nextAfter === null;
      } catch (_error) {
        if (isOpen() && request === version) status.replaceChildren(displayButton("Повторить поиск", () => load(after)));
      }
    };
    input.value = query;
    input.addEventListener("input", () => {
      clearTimeout(timer);
      version += 1;
      results.replaceChildren();
      status.textContent = "Ищем персонажей…";
      next.hidden = true;
      timer = setTimeout(load, 260);
    });
    body.querySelector("form").addEventListener("submit", (event) => {
      event.preventDefault();
      clearTimeout(timer);
      load();
    });
    next.addEventListener("click", () => load(nextAfter));
    openSheet(`${title} · ${price} пыли`, body);
    input.focus({ preventScroll: true });
    load();
  }

  async function createCharacterCard(character, query) {
    if (state.economyBusy || !state.profile?.economy?.craft_available) return;
    if (state.balance < character.price) {
      openWallet("dust", { missing: character.price - state.balance, onBack: () => openCraftSearch(character.rarity, query) });
      return;
    }
    state.economyBusy = true;
    renderEconomyStatus();
    try {
      if (!await showShopDialog({ title: "Создание карты", item: character.name,
        description: `${character.series}. Следующее создание будет доступно через 7 дней.`,
        art: "frame", price: character.price, currency: "dust" })) return;
      const result = await api("/api/craft", { method: "POST",
        body: JSON.stringify({ character_id: character.id, rarity: character.rarity }) });
      state.profile.economy.craft_available = false;
      state.profile.economy.craft_available_at = result.craft_available_at;
      if (el("craft-search-form")) closeSheet();
      startDropOpening({ crafted: true });
      await presentDrop(result, false);
    } catch (error) { showError(error); }
    finally { state.economyBusy = false; renderEconomyStatus(); }
  }

  async function loadUpgradeMask(card) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
    const query = new URLSearchParams({ upgrade_mask: "1", frame: card.frame_style || "classic" });
    if (appVersion) query.set("v", appVersion);
    try {
      const response = await fetch(`${apiBase}${card.image_url}?${query}`, {
        headers: { Authorization: `tma ${getInitData()}` },
      });
      if (!response.ok) return null;
      const blob = await response.blob();
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch (_error) {
      return null;
    }
  }

  async function upgradeCard(card, button, price, source) {
    if (state.economyBusy) return;
    state.economyBusy = true;
    button.disabled = true;
    const label = button.textContent;
    try {
      const effect = state.profile?.economy?.upgrade_effects?.[card.upgrade_level || 0];
      const upgradeMask = loadUpgradeMask(card);
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
          source,
          revealUpgrade: true,
          previousImageUrl: previewImage?.currentSrc,
          upgradeMask: result.card.frame_style === card.frame_style
            ? upgradeMask : loadUpgradeMask(result.card),
        });
      }
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

  async function downgradeCard(card, button, refund, source) {
    if (state.economyBusy) return;
    state.economyBusy = true;
    button.disabled = true;
    try {
      const level = card.upgrade_level;
      const effect = state.profile.economy.upgrade_effects[level - 1];
      if (!await confirmAction(`Снять эффект «${effect.title}» с карты «${card.name}»? Вернётся ${refund} пыли.`)) return;
      const result = await api(`/api/cards/${card.id}/downgrade`, {
        method: "POST", body: JSON.stringify({ expected_level: level }),
      });
      setBalance(result.balance);
      applyCardUpdate(result.card);
      if (button.isConnected && !el("sheet").hidden) openCardSheet(result.card, { source });
      renderFavorites();
      if (state.activePage === "collection" && state.collectionMode === "cards") renderCollection();
      showNotice(`Улучшение снято. Возвращено ${result.refund} пыли.`);
      haptic("success");
    } catch (error) { showError(error); }
    finally {
      state.economyBusy = false;
      button.disabled = Boolean(card.lock_reason);
      renderEconomyStatus();
    }
  }

  function renderCaseProgress() {
    const progress = state.caseCatalog?.progress;
    if (!progress) return;
    el("case-comparison").textContent = `Собрано рамок: ${progress.owned_frames}/${progress.total_frames}`;
    el("case-guarantee").textContent = progress.guarantee_in === null
      ? "Все рамки кейса собраны. Гарантия новой рамки пока не действует."
      : progress.guarantee_in === 1 ? "Следующее открытие гарантирует новую рамку!"
        : `Новая рамка гарантирована не позднее чем через ${progress.guarantee_in} открытий.`;
    const missing = new Set(progress.missing_frames.map(({ id }) => id));
    el("case-rewards").querySelectorAll("[data-case-frame]").forEach((tile) => {
      tile.textContent = missing.has(tile.dataset.caseFrame) ? "В коллекции пока нет" : "Уже в коллекции";
    });
  }

  el("dust-ticket-buy").addEventListener("click", purchaseDustTicket);

  function setShopTab(name, load = true) {
    state.shopTab = name;
    const titles = { rolls: "Билеты", frames: "Рамки", cases: "Кейсы", craft: "Создание" };
    el("shop-banner").dataset.kind = name;
    el("shop-banner").hidden = name === "gems";
    el("shop-banner-title").textContent = titles[name] || "";
    document.querySelectorAll("[data-shop-tab]").forEach((button) => {
      const active = button.dataset.shopTab === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    el("rolls-pane").hidden = name !== "rolls";
    el("frames-pane").hidden = name !== "frames";
    el("cases-pane").hidden = name !== "cases";
    el("craft-pane").hidden = name !== "craft";
    el("gems-pane").hidden = name !== "gems";
    if (name === "frames" && load) loadFrameShop().catch(showError);
    if (name === "cases") loadCaseCatalog().catch(showError);
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

  function renderAccountCardCount(count) {
    el("account-card-count").textContent = count ?? "—";
    el("account-card-noun").textContent = cardWord(count ?? 0);
  }

  function loadAccountPage() {
    renderAccountCardCount(state.profile ? state.ownedCardCount : null);
    const status = el("account-load-status");
    status.replaceChildren();
    loadAccount().catch((error) => {
      status.replaceChildren(displayButton("Повторить загрузку профиля", loadAccountPage));
      showError(error);
    });
  }

  async function loadAccount() {
    const [profile, favorites, rare, epic, legendary, mythical, referrals, showcases] = await Promise.all([
      fetchOwnProfile(),
      api("/api/favorites"),
      api("/api/inventory?rarity=rare&page=1"),
      api("/api/inventory?rarity=epic&page=1"),
      api("/api/inventory?rarity=legendary&page=1"),
      api("/api/inventory?rarity=mythical&page=1"),
      api("/api/referrals"),
      api("/api/showcases").catch(() => null),
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
    renderAccountCardCount(profile.card_count);
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
    const preview = el("profile-showcase");
    const showcase = showcases?.items.find(({ cards }) => cards.length);
    preview.replaceChildren();
    preview.hidden = !showcase;
    el("profile-showcase-empty").hidden = !showcases || Boolean(showcase);
    if (showcase) preview.append(renderDisplay({ ...showcase, cards: showcase.cards.slice(0, 3) }));
    const bgSection = el("profile-background-section");
    const isVip = profile.vip.active;
    bgSection.hidden = !isVip;
    if (isVip) {
      await renderBackgroundSelector();
    }
    renderFavorites();
  }

  function loadBackgrounds() {
    if (!state.backgroundCatalogRequest) {
      state.backgroundCatalogRequest = fetch(new URL("static/backgrounds/backgrounds.json", staticBase), { cache: "no-cache" })
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
    const settings = el("profile-settings");
    settings.setAttribute("aria-expanded", String(name === "gallery"));
    settings.setAttribute("aria-label", name === "gallery" ? "Закрыть настройки приватности" : "Настройки приватности");
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
    publicProfileRequest += 1;
    state.publicPlayer = null;
    state.publicInventoryPage = 0;
    state.publicInventoryLoading = false;
    state.publicInventoryIds.clear();
    showPage("account");
    window.scrollTo({ top: 0 });
  }

  let publicProfileRequest = 0;
  async function openPublicPlayer(playerId) {
    const version = ++publicProfileRequest;
    const origin = state.activePage;
    const profile = await api(`/api/players/${playerId}`);
    if (version !== publicProfileRequest || origin !== state.activePage) return;
    state.publicPlayer = profile;
    const showcases = profile.showcases || [];
    el("player-showcases").replaceChildren(...showcases.map((item) => {
      const preview = renderDisplay(item);
      preview.append(displayButton("Открыть витрину", () => openShowcase(item.token, "player")));
      return preview;
    }));
    el("player-showcases-section").hidden = !showcases.length;
    state.publicInventoryPage = 0;
    state.publicInventoryLoading = false;
    state.publicInventoryIds.clear();
    el("player-name").textContent = profile.display_name;
    el("player-id").textContent = `ID ${profile.id}`;
    setProfileAvatar("player-avatar", profile);
    el("player-vip").hidden = !profile.vip?.active;
    el("player-hero").classList.toggle("player-hero--vip", Boolean(profile.vip?.active));
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

  function openNotificationSettings() {
    const labels = {
      drop_ready: "Бесплатный дроп карты снова доступен",
      full_stock: "Полный запас открытий",
      incoming_trade: "Входящие предложения обмена",
      outbid: "Перебитые ставки",
      auction_result: "Итоги аукционов",
    };
    const body = document.createElement("div");
    body.className = "privacy-panel";
    const load = async () => {
      body.textContent = "Загружаем настройки…";
      try {
        const settings = await api("/api/me/notifications");
        body.replaceChildren();
        const fields = Object.entries(labels).map(([key, text]) => {
          const label = document.createElement("label");
          const field = document.createElement("input");
          field.type = "checkbox";
          field.checked = settings[key];
          label.append(field, text);
          body.append(label);
          return [key, field];
        });
        const save = displayButton("Сохранить настройки", async () => {
          if (save.disabled) return;
          save.disabled = true;
          try {
            await api("/api/me/notifications", {
              method: "POST",
              body: JSON.stringify(Object.fromEntries(fields.map(([key, field]) => [key, field.checked]))),
            });
            if (body.isConnected) closeSheet();
            showNotice("Настройки уведомлений сохранены.");
          } finally { save.disabled = false; }
        }, false);
        body.append(save);
      } catch (error) {
        body.replaceChildren(displayButton("Повторить загрузку", load));
        showError(error);
      }
    };
    openSheet("Уведомления Telegram", body);
    load();
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
    const status = el("frame-shop-status");
    status.textContent = "Загружаем рамки…";
    try { await loadFramesCatalog(); }
    catch (error) {
      status.replaceChildren(displayButton("Повторить загрузку рамок", loadFrameShop));
      throw error;
    }
    status.textContent = "";
    renderFrameShop();
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
    el("frame-shop-pages").hidden = data.pages <= 1;
    renderShopPreview();
  }

  let framePreviewOptions = [];

  function previewFrameOnCard(frameId, frames, title) {
    closeSheet();
    state.frameShopFrameId = frameId;
    openFrameShopPreview(frames, title);
    loadFrameShopCards(1).catch(showError);
  }

  function openFrameShopPreview(frames, title) {
    if (!frames.length) return;
    framePreviewOptions = frames;
    const dialog = el("frame-shop-preview");
    const select = el("frame-shop-frame");
    select.replaceChildren(...frames.map((frame) => {
      const label = frame.chance === undefined ? frame.title : `${frame.title} · ${frame.chance}%`;
      return new Option(label, frame.id);
    }));
    select.value = state.frameShopFrameId;
    if (select.selectedIndex < 0) select.selectedIndex = 0;
    state.frameShopFrameId = select.value;
    el("frame-shop-preview-title").textContent = title;
    dialog.showModal();
    dialog.scrollTop = 0;
    syncBackButton();
    renderShopPreview();
  }

  async function renderShopPreview() {
    const dialog = el("frame-shop-preview");
    if (!dialog.open) return;
    const version = ++state.framePreviewVersion;
    const image = el("frame-shop-image");
    const visual = el("frame-shop-visual");
    visual.replaceChildren(image);
    visual.hidden = true;
    const status = el("frame-shop-preview-status");
    const card = state.frameShopCards.find((item) => item.id === state.frameShopCardId);
    const manage = el("frame-shop-manage");
    manage.disabled = !card || Boolean(card.lock_reason);
    manage.hidden = !card;
    el("frame-shop-to-collection").hidden = Boolean(card);
    image.hidden = true;
    if (!card || !state.frameShopFrameId) {
      status.textContent = card ? "Выберите рамку для примерки." : "Получите карту, чтобы примерить рамку.";
      return;
    }
    status.textContent = "Загружаем примерку…";
    try {
      const url = await loadCardImageUrl(card, "", state.frameShopFrameId);
      if (!dialog.open || version !== state.framePreviewVersion) return;
      image.src = url;
      image.hidden = false;
      visual.hidden = false;
      const frame = framePreviewOptions.find((item) => item.id === state.frameShopFrameId);
      image.dataset.cardRarity = card.rarity;
      const fx = frameEffects(frame?.effect, card.rarity, frame?.rarity, frame?.accent, frame?.ornament_url, frame?.style, frame?.motion_url);
      if (fx) visual.append(fx);
      status.textContent = frame
        ? `Примерка: ${frame.title}${frame.id === card.frame_style ? " · На этой карте"
          : frame.quantity !== undefined ? ` · ${frameStockLabel(frame)}` : ""}`
        : "Примерка рамки";
    } catch (error) {
      if (dialog.open && version === state.framePreviewVersion) {
        status.replaceChildren(displayButton("Повторить загрузку примерки", renderShopPreview));
      }
    }
  }

  function updateCaseButton() {
    const button = el("case-open-button");
    const catalog = state.caseCatalog;
    if (!button || !catalog) return;
    el("case-open-price").textContent = formatCrystalCount(catalog.price);
    button.disabled = state.caseOpening;
    renderCaseProgress();
  }

  async function loadCaseCatalog() {
    if (state.caseOpening) return;
    try {
      state.caseCatalog = await api("/api/cases");
      el("case-loading-status").replaceChildren();
    } catch (error) {
      el("case-loading-status").replaceChildren(displayButton("Повторить загрузку кейсов", loadCaseCatalog));
      throw error;
    }
    el("case-rewards").replaceChildren(...state.caseCatalog.rewards.map((reward) => {
      const subtitle = reward.rarity_title || `Количество · ${reward.quantity}`;
      const tile = rewardTile(reward.title, casePrizeImage(reward.id, reward.preview_url),
        subtitle, "", () => openCaseReward(reward), !reward.frame_id);
      if (reward.frame_id) tile.lastElementChild.dataset.caseFrame = reward.frame_id;
      return tile;
    }));
    updateCaseButton();
  }

  function rewardTile(title, imageUrl, subtitle, note, action, resource = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reward-tile";
    button.classList.toggle("reward-tile--resource", resource);
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    const name = document.createElement("strong");
    name.textContent = title;
    const meta = document.createElement("span");
    meta.textContent = subtitle;
    const details = document.createElement("small");
    details.textContent = note;
    button.append(image, name, meta, details);
    button.addEventListener("click", action);
    return button;
  }

  function rewardVisual(imageUrl, frame) {
    const visual = document.createElement("div");
    visual.className = frame ? "reward-visual" : "reward-visual reward-visual--resource";
    const image = document.createElement("img");
    image.src = imageUrl;
    image.alt = "";
    image.decoding = "async";
    visual.append(image);
    if (frame) {
      const effect = frameEffects(frame.effect, frame.rarity, frame.rarity, frame.accent, frame.ornament_url, frame.style, frame.motion_url);
      if (effect) visual.append(effect);
    }
    return visual;
  }

  function openCaseReward(reward) {
    const body = document.createElement("div");
    body.className = "reward-detail";
    const preview = casePrizeImage(reward.id, reward.live_preview_url || reward.preview_url);
    const description = document.createElement("p");
    description.className = "hint";
    body.append(rewardVisual(preview, reward.frame_id ? reward : null), description);
    if (reward.frame_id) {
      const missing = state.caseCatalog.progress.missing_frames.some(({ id }) => id === reward.frame_id);
      description.textContent = `Рамка · ${reward.rarity_title} · ${missing ? "В коллекции пока нет" : "Уже в коллекции"}`;
      const tryOn = displayButton("Примерить на карте", () => {
        const frames = state.caseCatalog.rewards.filter((item) => item.frame_id)
          .map((item) => ({ ...item, id: item.frame_id }));
        previewFrameOnCard(reward.frame_id, frames, "Рамки премиум-кейса");
      });
      body.append(tryOn);
    } else {
      description.textContent = reward.id === "dust" ? `${reward.quantity} пыли` : `${reward.quantity} ${ticketWord(Number(reward.quantity))}`;
    }
    openSheet(reward.title, body);
  }

  function caseRewardSummary(result) {
    if (result.reward === "dust") return `Получено ${result.amount} игровой пыли`;
    if (result.reward.startsWith("roll_")) {
      return result.amount === 1
        ? "Получена 1 дополнительная крутка"
        : `Получено дополнительных круток: ${result.amount}`;
    }
    if (result.duplicate) {
      return result.frame_copies_awarded
        ? `Получена ещё одна рамка «${result.frame_title}»`
        : `Дубликат рамки «${result.frame_title}» · ${result.amount} пыли`;
    }
    return `Получена рамка «${result.frame_title}»`;
  }

  function casePrizeImage(reward, preview) {
    if (preview) return frameAssetUrl(preview);
    if (reward === "dust") return new URL("currency-dust.webp", staticBase).href;
    if (reward.startsWith("roll_")) return new URL("currency-ticket.webp", staticBase).href;
    return new URL("game-icon-summon-clear.webp", staticBase).href;
  }

  async function openCase() {
    if (state.caseOpening || state.packOpening || !state.caseCatalog) return;
    if (state.crystals < state.caseCatalog.price) {
      openWallet("crystals", { missing: state.caseCatalog.price - state.crystals, onBack: closeSheet });
      return;
    }
    state.caseOpening = true;
    updateCaseButton();
    const price = state.caseCatalog.price;
    const confirmed = await showShopDialog({
      title: "Подтверждение покупки", item: "Премиум-кейс",
      description: "Внутри пыль, билеты или коллекционная рамка.",
      art: "case", price, currency: "crystal",
    });
    if (!confirmed || state.caseCatalog?.price !== price) {
      state.caseOpening = false;
      updateCaseButton();
      if (confirmed) showError(new Error("Цена изменилась. Проверьте её и попробуйте снова."));
      return;
    }
    const rewards = state.caseCatalog.rewards;
    const overlay = showRoulette("Премиум-кейс", "Открываем кейс…", new URL("premium-case.webp", staticBase));

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
      const prizes = rewards.map((reward) => ({
        id: reward.id,
        title: reward.frame_id ? reward.title : `${reward.title} · ${reward.quantity}`,
        image: casePrizeImage(reward.id, reward.preview_url),
        resource: !reward.preview_url,
      }));
      const winningPreview = rewards.find((reward) => reward.id === result.reward)?.preview_url;
      await animateRoulette(prizes, {
        id: result.reward,
        title: result.frame_title || caseRewardSummary(result),
        image: casePrizeImage(result.reward, winningPreview || result.frame_preview_url),
        resource: !result.frame_id,
      });
    } catch (_error) {
      // Keep the awarded result visible even if a visual update fails.
      loadProfile().catch(showError);
    } finally {
      state.caseOpening = false;
      updateCaseButton();
      const legacyDuplicate = result.duplicate && !result.frame_copies_awarded;
      const fx = result.frame_id && !legacyDuplicate
        ? frameEffects(result.frame_effect, result.frame_rarity, result.frame_rarity,
          result.frame_accent, result.frame_ornament_url, result.frame_theme, result.frame_motion_url)
        : null;
      revealRouletteAward(caseRewardSummary(result),
        casePrizeImage(legacyDuplicate ? "dust" : result.reward, legacyDuplicate ? null : result.frame_preview_url), fx,
        legacyDuplicate || !result.frame_id);
    }
  }

  function framePackItem(frame) {
    const item = document.createElement("article");
    item.className = "frame-pack-item";
    item.dataset.rarity = frame.rarity;
    const image = document.createElement("img");
    image.className = "frame-pack-image";
    image.src = frameAssetUrl(frame.preview_url);
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    const tags = document.createElement("div");
    tags.className = "frame-pack-tags";
    const rarityCode = RARITIES.find(({ key }) => key === frame.rarity)?.title.split(" · ")[0];
    const rarity = document.createElement("span");
    rarity.className = "frame-pack-rarity";
    rarity.textContent = rarityCode || frame.rarity_title;
    rarity.setAttribute("aria-label", frame.rarity_title);
    tags.append(rarity);
    if (frame.chance !== undefined) {
      const chance = document.createElement("span");
      chance.className = "frame-pack-chance";
      chance.textContent = `${frame.chance}%`;
      chance.setAttribute("aria-label", `Шанс выпадения ${frame.chance}%`);
      tags.append(chance);
    }
    const title = document.createElement("strong");
    title.className = "frame-pack-name";
    title.textContent = frame.title;
    const meta = document.createElement("span");
    meta.className = "hint";
    meta.textContent = frame.owned ? `В коллекции · ×${frame.quantity}` : "Не получена";
    item.append(image, tags, title, meta);
    return item;
  }

  function renderFrameShop() {
    const container = el("frame-shop");
    container.replaceChildren();
    el("frame-shop-try").disabled = !state.shopFrames.length;
    state.framePacks.forEach((pack) => {
      const section = document.createElement("section");
      section.className = "frame-pack";
      const heading = document.createElement("h3");
      heading.textContent = pack.title;
      const description = document.createElement("p");
      description.className = "hint";
      description.textContent = `Собрано ${pack.items.filter((item) => item.owned).length} / ${pack.items.length}`;
      const header = document.createElement("header");
      header.className = "frame-pack-heading";
      header.append(heading, description);
      const actions = document.createElement("div");
      actions.className = "frame-pack-actions";
      [["dust", pack.dust_price, "пыли"], ["crystals", pack.crystal_price, "кристаллов"]].forEach(([currency, price, label]) => {
        const buy = document.createElement("button");
        buy.type = "button";
        buy.className = `btn btn-${currency === "dust" ? "secondary" : "primary"} frame-pack-open`;
        const priceIcon = document.createElement("span");
        priceIcon.className = `currency-icon chip-${currency === "dust" ? "dust" : "crystal"}`;
        priceIcon.setAttribute("aria-hidden", "true");
        buy.append("Открыть", priceIcon, String(price));
        buy.setAttribute("aria-label", `Открыть за ${price} ${label}`);
        buy.disabled = state.packOpening;
        buy.addEventListener("click", () => openFramePack(pack, currency));
        actions.append(buy);
      });
      const grid = document.createElement("div");
      grid.className = "frame-pack-items";
      grid.append(...pack.items.map(framePackItem));
      section.append(header, grid, actions);
      container.append(section);
    });
    const exclusives = document.createElement("details");
    exclusives.className = "frame-pack frame-pack-contents";
    const summary = document.createElement("summary");
    summary.textContent = "Эксклюзивы премиум-кейса · с эффектами";
    const grid = document.createElement("div");
    grid.className = "frame-pack-items";
    const caseFrames = state.shopFrames.filter((frame) => frame.case_available ?? frame.case_only);
    grid.append(...caseFrames.map(framePackItem));
    exclusives.append(summary, grid);
    container.append(exclusives);
  }

  function showRoulette(title, status, backdrop) {
    const overlay = el("frame-roulette");
    overlay.style.setProperty("--roulette-art", `url("${backdrop}")`);
    el("frame-roulette-title").textContent = title;
    el("frame-roulette-result").textContent = status;
    el("frame-roulette-close").hidden = true;
    el("frame-roulette-track").replaceChildren();
    el("frame-roulette-track").classList.remove("is-settled");
    el("frame-roulette-track").style.transform = "none";
    el("frame-roulette-award").replaceChildren();
    overlay.hidden = false;
    syncBackButton();
    el("frame-roulette-title").focus();
    return overlay;
  }

  let previousRoulette = null;

  async function animateRoulette(items, winner) {
    const track = el("frame-roulette-track");
    const winnerIndex = 21 + Math.floor(Math.random() * 5);
    const reel = Array.from({ length: winnerIndex + 5 }, () => null);
    reel[winnerIndex] = winner;
    for (const direction of [-1, 1]) {
      for (let index = winnerIndex + direction; index >= 0 && index < reel.length; index += direction) {
        const neighbor = reel[index - direction];
        const offset = index - winnerIndex;
        const previous = previousRoulette?.winner === winner.id && previousRoulette.neighbors[offset];
        const different = items.filter((item) => item.id !== neighbor.id && item.id !== previous);
        const candidates = different.length ? different : items.filter((item) => item.id !== neighbor.id);
        const pool = candidates.length ? candidates : items;
        reel[index] = pool[Math.floor(Math.random() * pool.length)];
      }
    }
    previousRoulette = {
      winner: winner.id,
      neighbors: { "-1": reel[winnerIndex - 1].id, 1: reel[winnerIndex + 1].id },
    };
    const tiles = reel.map((item, index) => {
      const tile = document.createElement("div");
      tile.className = "frame-roulette-tile";
      tile.classList.toggle("roulette-winner", index === winnerIndex);
      const image = document.createElement("img");
      image.src = item.image;
      image.alt = "";
      image.classList.toggle("roulette-resource", Boolean(item.resource));
      const name = document.createElement("span");
      name.textContent = item.title;
      tile.append(image, name);
      return tile;
    });
    track.replaceChildren(...tiles);
    const windowRect = el("frame-roulette-window").getBoundingClientRect();
    const winnerRect = tiles[winnerIndex].getBoundingClientRect();
    const offset = winnerRect.left + winnerRect.width / 2 - (windowRect.left + windowRect.width / 2);
    const end = `translateX(${-offset}px)`;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reduced.matches || document.hidden || !track.animate) {
      track.style.transform = end;
      track.classList.add("is-settled");
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
      track.classList.add("is-settled");
      animation.cancel();
      document.removeEventListener("visibilitychange", finish);
      reduced.removeEventListener("change", finish);
    }
  }

  function revealRouletteAward(summary, imageUrl, effects, resource = false) {
    const award = document.createElement("img");
    award.src = imageUrl;
    award.alt = "";
    award.classList.toggle("roulette-resource", resource);
    const container = el("frame-roulette-award");
    container.append(award);
    if (effects) container.append(effects);
    el("frame-roulette-result").textContent = summary;
    const close = el("frame-roulette-close");
    close.hidden = false;
    close.focus();
    haptic("success");
  }

  async function openFramePack(pack, currency) {
    if (state.packOpening || state.caseOpening) return;
    if (currency === "crystals" && state.crystals < pack.crystal_price) {
      openWallet("crystals", { missing: pack.crystal_price - state.crystals, onBack: closeSheet });
      return;
    }
    if (currency === "dust" && state.balance < pack.dust_price) {
      openWallet("dust", { missing: pack.dust_price - state.balance, onBack: closeSheet });
      return;
    }
    state.packOpening = true;
    renderFrameShop();
    const price = currency === "dust" ? pack.dust_price : pack.crystal_price;
    try {
      if (!await showShopDialog({ title: "Открыть пак рамок", item: pack.title,
        description: `Одна рамка. ${pack.items.map((frame) => `${frame.title} — ${frame.chance}%`).join(", ")}.`,
        art: "frame", price, currency: currency === "dust" ? "dust" : "crystal" })) return;
      const overlay = showRoulette(pack.title, "Открываем пак…", frameAssetUrl(pack.cover_url));
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
      const prize = (frame) => ({ id: frame.id, title: frame.title, image: frameAssetUrl(frame.preview_url) });
      try { await animateRoulette(pack.items.map(prize), prize(result.frame)); }
      catch (_error) { /* Reveal the server result even if motion is unavailable. */ }
      finally {
        const fx = frameEffects(result.frame.effect, result.frame.rarity, result.frame.rarity,
          result.frame.accent, result.frame.ornament_url, result.frame.style);
        const summary = result.duplicate
          ? (result.compensation_dust ? `Дубликат «${result.frame.title}» · ${result.compensation_dust} пыли.`
            : `Получена ещё одна рамка «${result.frame.title}»!`)
          : `Получена рамка «${result.frame.title}»!`;
        revealRouletteAward(summary, frameAssetUrl(result.frame.live_preview_url || result.frame.preview_url), fx);
      }
    } catch (error) { showError(error); }
    finally { state.packOpening = false; renderFrameShop(); }
  }

  function closeFrameRoulette() {
    if (state.packOpening || state.caseOpening) return;
    el("frame-roulette").hidden = true;
    el("frame-roulette-track").replaceChildren();
    el("frame-roulette-award").replaceChildren();
    syncBackButton();
  }

  el("frame-roulette-close").addEventListener("click", closeFrameRoulette);
  const frameShopPreview = el("frame-shop-preview");
  el("frame-shop-try").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await loadFrameShopCards(1);
      if (state.activePage === "crystals" && state.shopTab === "frames") {
        openFrameShopPreview(state.shopFrames, "Примерка рамок");
      }
    } catch (error) { showError(error); }
    finally { button.disabled = !state.shopFrames.length; }
  });
  el("frame-shop-preview-close").addEventListener("click", () => frameShopPreview.close());
  frameShopPreview.addEventListener("close", syncBackButton);
  el("frame-shop-frame").addEventListener("change", (event) => {
    state.frameShopFrameId = event.target.value;
    renderShopPreview();
  });
  el("frame-shop-card").addEventListener("change", (event) => {
    state.frameShopCardId = Number(event.target.value);
    renderShopPreview();
  });
  el("frame-shop-prev").addEventListener("click", () => loadFrameShopCards(state.frameShopPage - 1).catch(showError));
  el("frame-shop-next").addEventListener("click", () => loadFrameShopCards(state.frameShopPage + 1).catch(showError));
  el("frame-shop-manage").addEventListener("click", () => {
    const card = state.frameShopCards.find((item) => item.id === state.frameShopCardId);
    if (!card || card.lock_reason) return;
    frameShopPreview.close();
    openFramePicker(card, {
      frameId: state.frameShopFrameId,
      onBack: () => {
        closeSheet();
        if (state.activePage !== "crystals") return;
        loadFramesCatalog().then(() => {
          renderFrameShop();
        }).catch(showError);
      },
    });
  });

  async function equipFrame(card, frame) {
    const result = await api(`/api/cards/${card.id}/frame`, {
      method: "POST", body: JSON.stringify({ frame_id: frame.id }),
    });
    applyCardUpdate(result.card);
    if (state.activePage === "collection") {
      if (state.collectionMode === "cards") {
        if (!state.collectionLoading) renderCollection();
        renderReceivedCards();
      } else if (state.collectionMode === "frames") {
        loadFrameInventory();
      }
    }
    if (state.activePage === "account") renderFavorites();
    showNotice(frame.id === "classic" ? "Рамка снята и возвращена в инвентарь."
      : `Рамка «${frame.title}» надета на «${result.card.name}».`);
    haptic("success");
    return result.card;
  }

  function updateAuctionCountdowns() {
    if (document.hidden) return;
    document.querySelectorAll("[data-auction-expiry]").forEach((element) => {
      const seconds = Math.max(
        0, Number(element.dataset.auctionExpiry) - Math.floor(Date.now() / 1000));
      element.textContent = seconds === 0 ? "Завершение…" : formatDuration(seconds);
      element.classList.toggle("is-urgent", seconds > 0 && seconds <= 120);
      if (seconds === 0) {
        element.closest(".listing")?.querySelector(".listing-action")?.setAttribute("disabled", "true");
      }
    });
  }
  window.setInterval(updateAuctionCountdowns, 1000);

  let tradeLoadRevision = 0;

  function renderTradeCards(container, cards, emptyText) {
    container.replaceChildren();
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = emptyText;
      container.append(empty);
      return;
    }
    cards.forEach((card) => {
      const item = document.createElement("div");
      const caption = document.createElement("small");
      const details = [card.name, card.rarity_title, `#${card.print_no}`];
      if (card.upgrade_level) details.push(`+${card.upgrade_level}`);
      if (hasCustomFrame(card)) details.push(card.style_title);
      caption.textContent = details.join(" · ");
      const preview = cardButton(card, false, true);
      preview.disabled = true;
      item.append(preview, caption);
      container.append(item);
    });
  }

  function render() {
    const trade = state.trade;
    const ownOffer = trade?.viewer_is_sender;
    const pending = trade?.status === "pending";
    const hasReply = trade?.recipient_id != null;
    const opening = Boolean(state.tradeToken && !trade);
    const canSelect = !opening && (!trade || (pending && !ownOffer && !hasReply));
    const canConfirm = pending && ownOffer && hasReply;
    const left = canSelect ? selectedCards()
      : (ownOffer ? trade?.sender_cards : trade?.recipient_cards) || [];
    const right = trade
      ? ownOffer ? trade.recipient_cards : trade.sender_cards
      : [];
    el("left-count").textContent = formatCardCount(left.length);
    el("right-count").textContent = formatCardCount(right.length);
    renderTradeCards(el("left-cards"), left, canSelect ? "Выберите карты из инвентаря" : "Карт нет");
    renderTradeCards(el("right-cards"), right, "Игрок ещё не предложил карты");
    el("left-title").textContent = trade?.status === "accepted" ? "Вы отдали" : "Вы отдаёте";
    el("right-title").textContent = trade?.status === "accepted" ? "Вы получили" : "Вы получаете";
    el("trade-title").textContent = trade
      ? ownOffer
        ? hasReply ? `Обмен с игроком ${trade.recipient_name || "без имени"}` : "Ваше предложение обмена"
        : `Обмен от ${trade.sender_name || "игрока"}`
      : "Новое предложение";
    const statusText = {
      accepted: "Обмен завершён",
      cancelled: "Обмен отменён",
      expired: "Срок обмена истёк",
      pending: hasReply ? (ownOffer ? "Проверьте карты и подтвердите обмен" : "Ожидаем подтверждения автора")
        : (ownOffer ? "Ожидаем встречные карты" : "Выберите карты для ответа"),
    };
    el("trade-state").textContent = opening ? "Откройте или обновите предложение"
      : statusText[trade?.status] || "Выберите карты для обмена";
    el("inventory-section").hidden = !canSelect;
    el("inventory-title").textContent = trade
      ? "Ваш инвентарь · добавьте встречные карты"
      : "Ваш инвентарь · выберите карты";
    const inventoryCards = state.inventory.filter((card) =>
      card.name.toLowerCase().includes(state.query) ||
      card.series.toLowerCase().includes(state.query));
    el("inventory-cards").replaceChildren();
    if (canSelect && !inventoryCards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.style.gridColumn = "1 / -1";
      empty.textContent = state.inventory.length ? "По запросу ничего не найдено" : "В инвентаре нет карт";
      el("inventory-cards").append(empty);
    } else if (canSelect) {
      inventoryCards.forEach((card) => {
        const selected = state.selected.has(card.id);
        el("inventory-cards").append(cardButton(
          card, selected, Boolean(card.lock_reason) || (!selected && state.selected.size >= 10),
          () => {
            if (state.tradeSubmitting) return;
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
    primary.textContent = canConfirm ? "Подтвердить обмен" : trade ? "Предложить свои карты" : "Создать ссылку обмена";
    primary.disabled = state.tradeSubmitting || !(canConfirm || (canSelect && state.selected.size > 0));
    el("trade-primary-wrap").hidden = !(canSelect || canConfirm);
    cancel.hidden = !(pending && (ownOffer || hasReply));
    cancel.disabled = state.tradeSubmitting;
    const refresh = el("refresh-trade");
    refresh.hidden = !(opening || (pending && (ownOffer || hasReply)));
    refresh.disabled = state.tradeSubmitting;
    el("new-trade").hidden = !(opening || (trade && !pending));
    el("new-trade").disabled = state.tradeSubmitting;
    const hint = el("hint");
    hint.hidden = !pending;
    hint.textContent = hasReply
      ? "Карты обеих сторон зарезервированы. До подтверждения обмен можно отменить."
      : "Карты перейдут новым владельцам после подтверждения автора.";
    const canShare = Boolean(state.link && pending && ownOffer && !hasReply);
    el("share").classList.toggle("is-open", canShare);
    el("share").style.display = canShare ? "block" : "none";
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
    const revision = ++tradeLoadRevision;
    const info = await api(`/api/trades/${encodeURIComponent(state.tradeToken)}`);
    if (revision !== tradeLoadRevision) return;
    const needsInventory = !state.trade && info.status === "pending"
      && !info.viewer_is_sender && info.recipient_id == null;
    state.trade = info;
    render();
    if (needsInventory) await loadInventory(1);
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
  async function claimDailyReward() {
    el("daily-button").disabled = true;
    try {
      const result = await api("/api/daily-reward", { method: "POST", body: "{}" });
      setBalance(result.balance);
      if (state.profile) state.profile.daily_reward_available = false;
      el("daily-channel-link").hidden = true;
      el("daily-status").textContent = "Награда уже получена. После полуночи по Москве.";
      el("daily-button").textContent = "Получено";
      showNotice(`Получена ежедневная награда: +${result.amount} пыли.`);
      haptic("success");
    } catch (error) {
      if (error.code === "subscription_required") {
        el("daily-status").textContent = error.message;
        el("daily-button").textContent = "Проверить подписку";
        renderUpdateChannel(state.profile);
      } else showError(error);
      el("daily-button").disabled = false;
    }
  }

  function renderUpdateChannel(profile) {
    const url = profile?.updates_channel_url;
    for (const id of ["daily-channel-link", "profile-channel-link"]) {
      const link = el(id);
      link.hidden = !url || (id === "daily-channel-link" && !profile.daily_reward_available);
      if (url) link.href = url;
      else link.removeAttribute("href");
    }
  }

  function bugReportLocation() {
    if (state.activePage === "collection") return `collection/${state.collectionMode}`;
    if (state.activePage === "crystals") return `shop/${state.shopTab}`;
    return state.activePage;
  }

  async function encodeReportScreenshot(file) {
    if (file.size > 12_000_000) throw new Error("Выберите скриншот размером до 12 МБ.");
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      try { await image.decode(); }
      catch { throw new Error("Выберите изображение в формате PNG, JPEG или WebP."); }
      const canvas = document.createElement("canvas");
      let scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      let blob;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .82));
        if (blob?.size <= 400_000) break;
        scale *= .75;
      }
      if (!blob || blob.size > 400_000) throw new Error("Не удалось уменьшить скриншот.");
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(new Error("Не удалось прочитать скриншот."));
        reader.readAsDataURL(blob);
      });
    } finally { URL.revokeObjectURL(url); }
  }

  let reportSubmitting = false;
  function openBugReport() {
    const form = el("bug-report-template").content.firstElementChild.cloneNode(true);
    const date = form.elements.namedItem("occurred_at");
    const now = new Date();
    date.value = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const location = form.elements.namedItem("location");
    const reportedScreen = state.lastErrorLocation || state.reportPreviousScreen || bugReportLocation();
    const section = reportedScreen.split("/")[0];
    location.value = Array.from(location.options).some((option) => option.value === section) ? section : "account";
    const submit = form.querySelector("button[type=submit]");
    const status = form.querySelector("[role=status]");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (reportSubmitting) return;
      const description = form.elements.namedItem("description").value.trim();
      const file = form.elements.namedItem("screenshot").files[0];
      const occurredAt = Math.floor(new Date(date.value).getTime() / 1000);
      reportSubmitting = submit.disabled = true;
      status.textContent = "Отправляем обращение…";
      try {
        const screenshot = file ? await encodeReportScreenshot(file) : null;
        const result = await api("/api/bug-reports", {
          method: "POST",
          body: JSON.stringify({
            description, occurred_at: occurredAt, screenshot,
            location: location.value === section ? reportedScreen : location.value,
            app_version: (appVersion || "").slice(0, 32),
            platform: (window.Telegram?.WebApp?.platform || navigator.platform || "").slice(0, 32),
            device: `${screen.width}×${screen.height} · ${navigator.userAgent}`.slice(0, 256),
          }),
        });
        if (form.isConnected) closeSheet();
        showNotice(result.duplicate ? `Такое обращение уже есть · №${result.id}`
          : `Обращение №${result.id} отправлено.`);
      } catch (error) { status.textContent = error.message; }
      finally { reportSubmitting = submit.disabled = false; }
    });
    openSheet("Сообщить об ошибке", form);
  }
  async function purchaseRolls(button) {
    if (state.ticketPurchaseInProgress) return;
    const amount = Number(button.dataset.buyRolls);
    if (!Number.isSafeInteger(amount) || amount < 1) return;
    const price = amount * state.rollCrystalCost;
    if (state.crystals < price) {
      openWallet("crystals", { missing: price - state.crystals, onBack: closeSheet });
      return;
    }
    state.ticketPurchaseInProgress = true;
    updateRollShopButtons();
    try {
      const confirmed = await showShopDialog({
        title: "Подтверждение покупки", item: `${amount} ${ticketWord(amount)}`,
        description: `После покупки останется ${state.crystals - price} кристаллов.`,
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
    state.collectionVisited = false;
    state.receivedCards = state.receivedCards.filter((card) => !removed.has(card.id));
    state.favorites = state.favorites.filter((card) => !removed.has(card.id));
    if (removed.has(state.frameShopPinnedCard?.id)) state.frameShopPinnedCard = null;
    clearCollectionSelection();
    state.ownedCardCount = Math.max(0, state.ownedCardCount - removed.size);
    el("card-count").textContent = state.ownedCardCount;
    setBalance(result.balance);
  }

  async function dustSelected(estimate) {
    const cards = [...state.collectionSelected.values()];
    if (!cards.length || !Number.isInteger(estimate)) return;
    try {
      const result = await api("/api/dust", {
        method: "POST",
        body: JSON.stringify({ card_ids: cards.map((card) => card.id), estimate }),
      });
      removeDustedCards(result);
      if (state.activePage === "collection") refreshCollection();
      showNotice(`Распылено карт: ${result.card_ids.length}. Получено ${result.amount} пыли.`);
      haptic("success");
      return true;
    } catch (error) { showError(error); }
  }
  function refreshAfterTransfer() {
    state.collectionVisited = false;
    if (state.activePage === "collection") refreshCollection();
    if (state.activePage === "trade" && state.marketTab === "trade" && !state.tradeToken) {
      loadInventory(state.page).catch(showError);
    }
  }

  function openTransferComposer(cards, back = null) {
    if (!cards.length) return;
    const card = cards.length === 1 ? cards[0] : null;
    const body = document.createElement("section");
    body.className = "transfer-composer";
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Ссылка действует 24 часа.";
    const link = displayButton("Создать ссылку передачи", async () => {
      if (state.transferSubmitting) return;
      state.transferSubmitting = link.disabled = true;
      try {
        const warning = frameHandoffWarning(cards);
        if (!await confirmAction(`Создать ссылку передачи? ${warning}`.trim())) return;
        const result = await api("/api/transfers", {
          method: "POST",
          body: JSON.stringify({ card_ids: cards.map(({ id }) => id) }),
        });
        clearCollectionSelection();
        refreshAfterTransfer();
        if (body.isConnected && !el("sheet").hidden) {
          openShareLink("Ссылка передачи", result.link, "Передаю тебе карты!");
        }
      } finally {
        state.transferSubmitting = link.disabled = false;
      }
    }, false);
    body.append(link, hint);
    if (card) {
      const gift = document.createElement("details");
      gift.className = "transfer-gift";
      const summary = document.createElement("summary");
      summary.textContent = "Именной подарок";
      gift.append(summary, giftForm(card));
      body.append(gift);
    }
    openSheet(card ? `Передать · ${card.name}` : `Передать · ${formatCardCount(cards.length)}`, body, null, back);
  }

  function openPendingTransfers() {
    const body = document.createElement("section");
    body.className = "transfer-link-list";
    openSheet("Ссылки передачи", body);

    async function load() {
      body.textContent = "Загружаем…";
      try {
        const { items } = await api("/api/transfers");
        if (!body.isConnected || el("sheet").hidden) return;
        body.replaceChildren();
        if (!items.length) body.textContent = "Активных ссылок нет.";
        for (const transfer of items) {
          const row = document.createElement("article");
          row.className = "transfer-link-row";
          const title = document.createElement("strong");
          const single = transfer.cards.length === 1;
          title.textContent = single ? transfer.cards[0].name : formatCardCount(transfer.cards.length);
          const meta = document.createElement("span");
          meta.className = "hint";
          meta.textContent = transfer.is_gift ? "Именной подарок"
            : single ? "Передача по ссылке" : transfer.cards.map(({ name }) => name).join(", ");
          const cancel = displayButton("Отменить", async () => {
            if (cancel.disabled) return;
            cancel.disabled = true;
            try {
              if (!await confirmAction("Отменить ссылку и освободить карты?")) return;
              await api(`/api/transfers/${transfer.id}`, { method: "DELETE" });
              refreshAfterTransfer();
              if (body.isConnected && !el("sheet").hidden) await load();
            } finally { cancel.disabled = false; }
          });
          row.append(title, meta, cancel);
          body.append(row);
        }
      } catch (error) {
        if (body.isConnected && !el("sheet").hidden) {
          body.replaceChildren(displayButton("Повторить загрузку", load));
          showError(error);
        }
      }
    }
    load();
  }

  function openShareLink(title, link, message) {
    const body = document.createElement("div");
    body.className = "wallet-actions";
    const input = document.createElement("input");
    input.className = "field";
    input.readOnly = true;
    input.value = link;
    input.setAttribute("aria-label", "Ссылка для отправки");
    const copy = displayButton("Копировать", async () => {
      try {
        await navigator.clipboard.writeText(link);
        copy.textContent = "Скопировано";
      }
      catch (_error) { input.select(); }
    });
    const send = displayButton("Отправить", () => {
      const text = encodeURIComponent(message);
      if (tg?.openTelegramLink) {
        tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`);
      } else window.open(link, "_blank", "noopener");
    }, false);
    body.append(input, copy, send);
    openSheet(title, body);
  }

  function giftForm(card) {
    const body = document.createElement("form");
    body.className = "gift-composer";
    const recipientLabel = document.createElement("label");
    recipientLabel.textContent = "Получатель";
    const recipient = document.createElement("input");
    recipient.className = "field";
    recipient.type = "search";
    recipient.maxLength = 40;
    recipient.placeholder = "Имя, @username или Telegram ID";
    recipient.required = true;
    recipientLabel.append(recipient);
    const matches = document.createElement("div");
    matches.className = "gift-player-results";
    matches.setAttribute("aria-live", "polite");
    let searchTimer;
    let selectedRecipient = null;
    recipient.addEventListener("input", () => {
      clearTimeout(searchTimer);
      selectedRecipient = null;
      matches.replaceChildren();
      const query = recipient.value.trim().replace(/^@/, "");
      if (query.length < 2 || /^\d+$/.test(query)) return;
      searchTimer = setTimeout(async () => {
        if (!body.isConnected) return;
        try {
          const { items } = await api(`/api/players?q=${encodeURIComponent(query)}`);
          if (!body.isConnected || selectedRecipient || recipient.value.trim().replace(/^@/, "") !== query) return;
          const options = items.filter((player) => player.id !== state.profile?.id).slice(0, 6);
          if (!options.length) matches.textContent = "Игрок не найден. Можно указать его ID.";
          for (const player of options) {
            matches.append(displayButton(`${player.display_name} · ID ${player.id}`, () => {
              selectedRecipient = player.id;
              recipient.value = player.display_name;
              matches.replaceChildren();
            }));
          }
        } catch (error) {
          if (body.isConnected && !selectedRecipient && recipient.value.trim().replace(/^@/, "") === query) {
            matches.textContent = "Поиск недоступен. Можно указать ID.";
          }
        }
      }, 250);
    });
    const messageLabel = document.createElement("label");
    messageLabel.textContent = "Послание";
    const message = document.createElement("textarea");
    message.className = "field";
    message.maxLength = 160;
    message.rows = 2;
    messageLabel.append(message);
    const submit = document.createElement("button");
    submit.className = "btn btn-primary btn-block";
    submit.textContent = "Создать ссылку на подарок";
    let previousBody, requestId;
    body.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (state.transferSubmitting) return;
      const input = recipient.value.trim();
      const recipientId = selectedRecipient ?? (/^\d+$/.test(input) ? Number(input) : null);
      if (!Number.isSafeInteger(recipientId) || recipientId <= 0 || recipientId === state.profile?.id) {
        showNotice("Выберите получателя или укажите его Telegram ID.");
        return;
      }
      const payload = JSON.stringify({ card_id: card.id, recipient_id: recipientId, message: message.value });
      if (payload !== previousBody) {
        previousBody = payload;
        requestId = newRequestId();
      }
      state.transferSubmitting = submit.disabled = true;
      try {
        const warning = frameHandoffWarning([card]);
        if (warning && !await confirmAction(warning)) return;
        const result = await api("/api/gifts", { method: "POST", body: payload, idempotencyKey: requestId });
        refreshAfterTransfer();
        if (body.isConnected && !el("sheet").hidden) {
          openShareLink("Подарок готов", result.link, "Для тебя подарок в Chizu!");
        }
      } catch (error) { showError(error); }
      finally { state.transferSubmitting = submit.disabled = false; }
    });
    body.append(recipientLabel, matches, messageLabel, submit);
    return body;
  }

  async function openGiftEnvelope(token) {
    const path = `/api/gifts/${encodeURIComponent(token)}`;
    const gift = await api(path);
    const body = document.createElement("section");
    body.className = "gift-envelope";
    const seal = document.createElement("div");
    seal.className = "gift-envelope-seal";
    seal.textContent = "☾";
    seal.setAttribute("aria-hidden", "true");
    const sender = document.createElement("strong");
    sender.textContent = `От ${gift.sender_name}`;
    const message = document.createElement("p");
    message.textContent = gift.message;
    const open = displayButton(gift.opened ? "Посмотреть карту" : "Открыть подарок", async () => {
      open.disabled = true;
      try {
        const { card } = await api(`${path}/open`, { method: "POST" });
        closeSheet();
        if (gift.opened) {
          openCardSheet(card);
          return;
        }
        startDropOpening({ gift: true });
        const session = dropSession;
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          await revealDrop(card, 0, 1, session);
        }
        clearTimeout(state.dropStageTimer);
        if (!session.cancelled) showDropResults([card]);
        loadProfile().catch(showError);
      } catch (error) { showError(error); }
      finally { open.disabled = false; }
    }, false);
    body.append(seal, sender, message, open);
    openSheet("Лунный конверт", body);
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
  function skipDropReveal() {
    if (!dropSession) return;
    stopDropMotion();
    el("drop-skip").hidden = true;
    el("drop-to-results").hidden = true;
    if (!el("drop-overlay").classList.contains("is-sequence")) {
      el("drop-description").textContent = "Ожидаем ответ сервера…";
    }
  }
  el("drop-skip").addEventListener("click", skipDropReveal);
  el("drop-to-results").addEventListener("click", skipDropReveal);
  el("drop-dust").addEventListener("click", async () => {
    if (!state.lastDropCard) return;
    const card = state.lastDropCard;
    closeDropOpening();
    state.collectionSelected = new Map([[card.id, card]]);
    reviewSelectedCards();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !el("vip-history-dialog").open && !frameShopPreview.open) {
      if (!el("shop-dialog").hidden) closeShopDialog(false);
      else if (!el("info-popup").hidden) closeInfoPopup();
      else if (!el("frame-roulette").hidden) closeFrameRoulette();
      else if (!el("drop-overlay").hidden) closeDropOpening();
      else if (!el("sheet").hidden) backFromSheet();
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
  el("sheet-body").addEventListener("click", (event) => {
    if (el("sheet").classList.contains("sheet--card") &&
        (event.target === event.currentTarget || event.target.classList.contains("card-detail-content"))) closeSheet();
  });

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
    if (state.tradeSubmitting || el("primary").disabled) return;
    const trade = state.trade;
    const token = state.tradeToken;
    const cards = selectedCards();
    const confirming = trade?.viewer_is_sender;
    const terms = confirming ? [...trade.sender_cards, ...trade.recipient_cards]
      : trade ? [...cards, ...trade.sender_cards] : cards;
    const prompt = confirming ? "Подтвердить обмен этими картами? Отменить его будет нельзя."
      : trade ? "Отправить выбранные карты на подтверждение автора?" : "Создать ссылку обмена?";
    state.tradeSubmitting = true;
    el("primary").disabled = true;
    el("cancel").disabled = true;
    el("refresh-trade").disabled = true;
    try {
      if (!await confirmAction(`${prompt} ${frameHandoffWarning(terms)}`)) return;
      if (trade) {
        const action = confirming ? "confirm" : "propose";
        const body = confirming ? {
          sender_card_ids: trade.sender_cards.map((card) => card.id),
          recipient_card_ids: trade.recipient_cards.map((card) => card.id),
        } : { card_ids: cards.map((card) => card.id) };
        await api(`/api/trades/${encodeURIComponent(token)}/${action}`, {
          method: "POST", body: JSON.stringify(body),
        });
        state.selected.clear();
        await loadTrade();
        haptic("success");
      } else {
        await createOffer(cards);
        state.selected.clear();
      }
    } catch (error) { showError(error); }
    finally { state.tradeSubmitting = false; render(); }
  });
  el("cancel").addEventListener("click", async () => {
    if (state.tradeSubmitting) return;
    state.tradeSubmitting = true;
    render();
    try {
      await api(`/api/trades/${encodeURIComponent(state.tradeToken)}/cancel`, {
        method: "POST", body: "{}",
      });
      await loadTrade();
    } catch (error) { showError(error); }
    finally { state.tradeSubmitting = false; render(); }
  });
  el("refresh-trade").addEventListener("click", async () => {
    if (state.tradeSubmitting) return;
    state.tradeSubmitting = true;
    render();
    try { await loadTrade(); }
    catch (error) { showError(error); }
    finally { state.tradeSubmitting = false; render(); }
  });
  el("new-trade").addEventListener("click", () => {
    ++tradeLoadRevision;
    state.trade = null;
    state.tradeToken = null;
    state.link = null;
    state.selected.clear();
    const url = new URL(location.href);
    url.searchParams.delete("trade");
    history.replaceState(history.state, "", url);
    render();
    loadInventory(1).catch(showError);
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
  el("profile-settings").addEventListener("click", () => {
    showProfileTab(el("account-gallery-view").hidden ? "gallery" : "mine");
  });
  el("privacy-save").addEventListener("click", () =>
    saveProfilePrivacy().catch(showError));
  el("notification-settings").addEventListener("click", openNotificationSettings);
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
  marketFilters().forEach((button) => {
    button.addEventListener("click", () => {
      button.setAttribute("aria-pressed", String(button.getAttribute("aria-pressed") !== "true"));
      clearTimeout(state.marketSearchTimer);
      loadMarket().catch(showError);
    });
  });
  el("market-search").addEventListener("input", () => {
    clearTimeout(state.marketSearchTimer);
    el("market-more").disabled = true;
    state.marketVersion = (state.marketVersion || 0) + 1;
    state.marketSearchTimer = setTimeout(() => loadMarket().catch(showError), 250);
  });
  el("market-more").addEventListener("click", () => loadMarket(state.marketNextPage).catch(showError));
  bindHomeSummonTilt();
  el("drop-all-button").addEventListener("click", () => openDrop(true));
  el("drop-button").addEventListener("click", () => openDrop());
  el("drop-retry").addEventListener("click", () => {
    el("drop-retry").hidden = true;
    el("drop-timer").textContent = "Обновляем запас…";
    loadProfile().catch(showDropLoadError);
  });
  el("case-open-button").addEventListener("click", openCase);
  document.querySelectorAll("[data-buy-rolls]").forEach((button) => {
    button.addEventListener("click", () => purchaseRolls(button));
  });
  el("ticket-amount").addEventListener("input", updateRollShopButtons);
  document.querySelectorAll("[data-ticket-amount]").forEach((button) => {
    button.addEventListener("click", () => {
      el("ticket-amount").value = button.dataset.ticketAmount;
      updateRollShopButtons();
    });
  });
  document.querySelectorAll("[data-wallet]").forEach((button) => {
    button.addEventListener("click", () => openWallet(button.dataset.wallet));
  });
  el("daily-button").addEventListener("click", claimDailyReward);
  for (const id of ["daily-channel-link", "profile-channel-link"]) {
    el(id).addEventListener("click", (event) => {
      if (!tg?.openTelegramLink) return;
      event.preventDefault();
      tg.openTelegramLink(event.currentTarget.href);
    });
  }
  el("bug-report-open").addEventListener("click", openBugReport);
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
  el("operation-retry").addEventListener("click", recoverEconomyOperation);
  el("collection-layout").addEventListener("click", () => {
    state.compactCollection = !state.compactCollection;
    playerPreference("collection-layout", state.compactCollection ? "list" : "grid");
    if (!state.collectionLoading) renderCollection();
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
    if (state.collectionMode !== "cards") {
      loadedCollectionModes.delete("cards");
      setCollectionMode("cards");
    } else {
      renderCollectionFilters();
      reloadCatalog();
    }
  });
  el("collection-album-back").addEventListener("click", () => {
    albums.series = null;
    loadCollectionAlbums(albums.listPage).then(() => window.scrollTo(0, albums.listScroll || 0)).catch(showError);
  });
  el("album-favorites-filter").addEventListener("click", () => {
    albums.favorites = !albums.favorites;
    loadCollectionAlbums(1).catch(showError);
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
    if (state.collectionMode === "duplicates") {
      copies.selected.clear();
      el("collection-copy-items").querySelectorAll("input:checked").forEach((checkbox) => { checkbox.checked = false; });
      updateCopySelection();
      return;
    }
    clearCollectionSelection();
    renderCollection();
  });
  el("select-review").addEventListener("click", () => {
    if (state.collectionMode === "duplicates") reviewCollectionCopies();
    else reviewSelectedCards();
  });
  el("collection-more").addEventListener("click", () =>
    loadCollection(state.collectionPage + 1).catch(showError));
  function goToFirstCard() {
    showPage("home");
    el("drop-button").focus();
  }
  el("collection-first-card").addEventListener("click", goToFirstCard);
  el("frame-shop-to-collection").addEventListener("click", () => {
    frameShopPreview.close();
    goToFirstCard();
  });
  el("dust-selected").addEventListener("click", reviewSelectedCards);
  el("transfer-links-open").addEventListener("click", openPendingTransfers);
  el("sell-selected").addEventListener("click", sellSelected);
  function startAuctionSelection() {
    if (state.collectionMode !== "cards") setCollectionMode("cards");
    clearCollectionSelection();
    showPage("collection");
    if (!state.ownedCardCount) return;
    if (!el("collection-reset").hidden) el("collection-reset").click();
    state.selectMode = true;
    renderCollectionSelection();
    if (!state.collectionLoading) renderCollection();
    showToast("Выберите одну карту, затем «Продать».");
  }
  el("create-lot").addEventListener("click", startAuctionSelection);
  document.querySelectorAll("[data-select-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.selectAction;
      if (action === "transfer") openTransferComposer([...state.collectionSelected.values()]);
      if (action === "sell") {
        const cards = [...state.collectionSelected.values()];
        if (cards.length === 1) openSellSheet(cards[0]);
        else showError(new Error("Для продажи выберите одну карту."));
      }
    });
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
      else if (frameShopPreview.open) frameShopPreview.close();
      else if (!el("shop-dialog").hidden) closeShopDialog(false);
      else if (!el("info-popup").hidden) closeInfoPopup();
      else if (!el("frame-roulette").hidden) closeFrameRoulette();
      else if (!el("drop-overlay").hidden) closeDropOpening();
      else if (!el("sheet").hidden) backFromSheet();
      else if (state.activePage === "player") closePlayerProfile();
      else if (state.activePage === "showcases") backFromShowcases();
      else if (state.activePage === "collection" && state.collectionMode === "albums" && albums.series !== null) {
        el("collection-album-back").click();
      }
    });
  } catch (_error) { /* browser preview */ }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state.activePage === "collection") rememberCollectionSettings();
    else if (document.visibilityState === "visible" && getInitData()) {
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

  function openShowcaseCardPreview(card, trigger) {
    haptic("light");
    const body = document.createElement("div");
    body.className = "card-detail-content card-detail-preview";
    const name = document.createElement("h3");
    name.textContent = card.name;
    const details = document.createElement("p");
    details.className = "hint card-frame-status";
    details.textContent = [card.series, card.rarity_title, formatPrintNumber(card)].filter(Boolean).join(" · ");
    body.append(renderCardInspection(card), name, details);
    openSheet(card.name, body);
    el("sheet").classList.add("sheet--card");
    sheetReturnFocus = trigger;
    el("sheet-close").focus({ preventScroll: true });
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
    subtitle.textContent = `${displayThemes[item.theme]} · ${formatCardCount(item.card_count ?? item.cards.length)}`;
    header.append(kicker, title, subtitle);
    article.append(header);
    const grid = document.createElement("div");
    grid.className = "showcase-grid";
    item.cards.forEach((card, index) => {
      const slot = document.createElement("div");
      slot.className = "showcase-slot";
      const tile = cardButton(card, false, false, null, "");
      tile.addEventListener("click", () => openShowcaseCardPreview(card, tile));
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
    el("showcase-share-chat").hidden = true;
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
  el("showcase-share-chat").addEventListener("click", (event) => {
    if (!tg?.openTelegramLink) return;
    event.preventDefault();
    tg.openTelegramLink(event.currentTarget.href);
    tg.close?.();
  });
  el("showcase-share").addEventListener("click", async (event) => {
    const item = displayState.viewed;
    const button = event.currentTarget;
    if (!item?.link || button.disabled) return;
    const status = el("showcase-share-status");
    const chat = el("showcase-share-chat");
    const shareDialog = typeof tg?.shareMessage === "function" && Boolean(tg.isVersionAtLeast?.("8.0"));
    const stillViewing = () => state.activePage === "showcases" && displayState.mode === "view" &&
      displayState.viewed === item;
    button.disabled = true;
    button.textContent = "Готовим картинку…";
    chat.hidden = true;
    status.textContent = "";
    try {
      const { message_id, bot_link } = await api(`/api/showcases/${encodeURIComponent(item.token)}/share`, {
        method: "POST", body: JSON.stringify({ share_dialog: shareDialog }),
      });
      if (!stillViewing()) return;
      if (bot_link) {
        chat.href = bot_link;
        chat.hidden = false;
        status.textContent = "Коллаж со ссылкой уже в чате с Chizu. Его можно переслать оттуда.";
      }
      if (message_id && shareDialog) tg.shareMessage(message_id);
    } catch (error) {
      if (stillViewing() && chat.hidden) {
        status.textContent = error.message || "Не удалось подготовить витрину. Попробуйте ещё раз.";
      }
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
      window.ChizuLoader?.fail("Откройте мини-приложение из Telegram.", true);
      showDropLoadError(new Error("Откройте мини-приложение из Telegram."));
      el("drop-retry").hidden = true;
      el("inventory-cards").replaceChildren();
    } else {
      loadProfile().then(() => {
        state.compactCollection = playerPreference("collection-layout") === "list";
        restoreCollectionSettings();
        restorePendingOperation();
        if (state.tradeToken) showPage("trade");
        const showcaseToken = new URLSearchParams(location.search).get("showcase");
        if (showcaseToken) openShowcase(showcaseToken).catch(showError);
        const giftToken = new URLSearchParams(location.search).get("gift");
        if (giftToken) openGiftEnvelope(giftToken).catch((error) => openInfoPopup("Подарок", error.message));
        window.ChizuLoader?.finish();
      }).catch((error) => {
        showDropLoadError(error);
        window.ChizuLoader?.fail(error.message || "Не удалось загрузить профиль.");
      });
    }
  }
  startApp();
})();
