(() => {
  "use strict";
  const source = new URL(document.currentScript.src);
  const css = document.createElement("link");
  css.rel = "stylesheet";
  css.href = new URL(`monitor.css${source.search}`, source).href;
  document.head.append(css);
  const configured = document.querySelector('meta[name="mini-app-api"]')?.content.trim() || "";
  const api = configured.startsWith("__") ? "" : configured.replace(/\/+$/, "");
  const tg = window.Telegram?.WebApp;
  tg?.ready();
  tg?.expand();
  document.title = "Chizu · Мониторинг";
  const root = document.createElement("main");
  root.id = "chizu-monitor";
  root.innerHTML = `<header><div><span class="eyebrow">CHIZU / ADMIN</span><h1>Мониторинг</h1></div><button id="mon-back">В игру</button></header>
    <div class="toolbar"><label>Период <select id="mon-days"><option value="1">Сегодня · UTC</option><option value="7">7 календарных дней · UTC</option><option value="30">30 календарных дней · UTC</option></select></label>
    <button id="mon-refresh">Обновить</button><button id="mon-export">CSV</button></div>
    <p id="mon-message" role="status" aria-live="polite">Загрузка…</p><div id="mon-content"></div>
    <footer>Доступ только администраторам. Обновление каждые 60 секунд, пока панель открыта.</footer>`;
  const mount = () => {
    const loader = document.getElementById("style-loading");
    document.body.replaceChildren(...(loader ? [loader, root] : [root]));
    window.ChizuLoader?.finish();
    document.body.className = "monitor-page";
    updateScrollableTables();
  };
  css.onload = mount;
  css.onerror = () => window.ChizuLoader?.fail("Не удалось загрузить оформление мониторинга.");
  const $ = (id) => root.querySelector(`#${id}`);
  const esc = (s) => String(s ?? "—").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
  const n = (v) => v == null ? "—" : Number(v).toLocaleString("ru-RU", {maximumFractionDigits: 1});
  const bytes = (v) => v == null ? "—" : `${n(v / 1024 ** 2)} МБ`;
  const age = (v) => v == null ? "—" : v < 3600 ? `${n(Math.floor(v / 60))} мин` : `${n(v / 3600)} ч`;
  const date = (v) => new Date(v * 1000).toLocaleString("ru-RU", {timeZone: "UTC"}) + " UTC";
  const labels = {drop: "Бесплатные открытия", extra_roll_used: "Открытия за билеты", daily_reward_claimed: "Ежедневные награды",
    frame_pack_opened: "Па­ки рамок", case_opened: "Кейсы", card_crafted: "Создание карт", card_upgraded: "Улучшения",
    trade_accepted: "Завершённые обмены", transfer_accepted: "Передачи",
    auction_sold: "Проданные аукционы", crystals_purchased: "Покупки кристаллов", admin_grant: "Выдачи администратора",
    rolls_purchased: "Покупки билетов", dust_ticket_purchased: "Билеты за пыль", bid_reserve: "Резерв ставки",
    bid_refund: "Возврат ставки", auction_sale: "Продажа на аукционе", case_reward: "Награда кейса",
    case_duplicate: "Дубликат кейса", frame_pack_duplicate: "Дубликат рамки", dust: "Распыление",
    crystals: "Кристаллы", rolls: "Билеты"};
  const currency = {dust: "Пыль", crystals: "Кристаллы", rolls: "Билеты"};
  const issueLabels = {monitoring_or_database: "Нет свежей статистики или доступа к БД", telegram_polling: "Нет успешного ответа Telegram > 2 минут",
    "drop-reminder": "Сбой или задержка напоминаний", "auction-settlement": "Сбой или задержка расчёта аукционов",
    disk_space: "Свободно меньше 512 МБ", notification_backlog: "Уведомления ожидают больше 15 минут", server_errors: "10 и более технических ошибок за 5 минут"};
  const tile = (name, value, detail = "") => `<article class="metric"><span>${esc(name)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`;
  const section = (title, content, note = "") => `<section><h2>${esc(title)}</h2>${note ? `<p class="muted">${esc(note)}</p>` : ""}${content}</section>`;
  const table = (headers, rows) => rows.length ? `<div class="table-scroll"><table><thead><tr>${headers.map(h => `<th scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : `<p class="muted">За этот период данных пока нет.</p>`;
  function updateScrollableTables() {
    root.querySelectorAll(".table-scroll").forEach((region) => {
      const horizontal = region.scrollWidth > region.clientWidth + 1;
      const vertical = region.scrollHeight > region.clientHeight + 1;
      region.classList.toggle("table-scroll--wide", horizontal);
      if (horizontal || vertical) {
        region.tabIndex = 0;
        region.setAttribute("role", "region");
        const title = region.closest("section").querySelector("h2").textContent;
        region.setAttribute("aria-label", horizontal ? `${title}. Таблицу можно прокручивать вправо и влево.` : title);
      } else {
        region.removeAttribute("tabindex");
        region.removeAttribute("role");
        region.removeAttribute("aria-label");
      }
    });
  }
  function chart(title, rows, start, days) {
    const map = new Map(rows.map(r => [r.day, r.count]));
    const values = Array.from({length: days}, (_, i) => ({day: start + i * 86400, count: map.get(start + i * 86400) || 0}));
    const max = Math.max(1, ...values.map(v => v.count));
    return `<div class="chart"><h3>${esc(title)}</h3><p class="muted">Ось X: дата UTC · ось Y: количество, от 0 до ${n(max)}</p><div class="bars" role="img" aria-label="${esc(title)}">${values.map(v => {
      const d = new Date(v.day * 1000).toISOString().slice(5, 10);
      return `<div class="bar-column" title="${d}: ${n(v.count)}"><span>${n(v.count)}</span><div class="bar-track"><i style="height:${v.count / max * 100}%"></i></div><small>${d}</small></div>`;
    }).join("")}</div></div>`;
  }
  function systemChart(rows) {
    const samples = rows.map(r => ({at: r.minute, cpu: JSON.parse(r.payload).process_cpu_percent})).filter(r => Number.isFinite(r.cpu));
    if (!samples.length) return "";
    const max = Math.max(10, Math.ceil(Math.max(...samples.map(r => r.cpu)) / 10) * 10);
    const start = samples[0].at, end = samples[samples.length - 1].at;
    const points = samples.map(r => `${30 + (r.at - start) / Math.max(1, end - start) * 310},${100 - r.cpu / max * 85}`).join(" ");
    return `<div class="chart"><h3>CPU процесса по времени</h3><p class="muted">Ось X: время UTC · ось Y: CPU, % · последний снимок каждого часа</p>
      <svg viewBox="0 0 360 125" role="img" aria-label="CPU процесса от ${esc(date(start))} до ${esc(date(end))}"><path d="M30 10V100H345" fill="none" stroke="#59436f"/><text x="2" y="18" fill="#c7b8db" font-size="10">${max}%</text><text x="8" y="100" fill="#c7b8db" font-size="10">0</text><polyline points="${points}" fill="none" stroke="#c6a5ec" stroke-width="2"/>${samples.length === 1 ? `<circle cx="30" cy="${100 - samples[0].cpu / max * 85}" r="3" fill="#c6a5ec"/>` : ""}</svg>
      <p class="muted">${esc(date(start))} — ${esc(date(end))}</p></div>`;
  }
  function render(d) {
    const runtime = d.runtime, snap = d.snapshot, system = snap.system || {}, players = snap.players || {}, q = snap.notifications || {};
    const events = Object.fromEntries(d.events.map(v => [v.kind, v.count]));
    const previous = Object.fromEntries(d.previous_events.map(v => [v.kind, v.count]));
    const registrations = d.registrations.filter(v => v.day >= d.start).reduce((s, v) => s + v.count, 0);
    const paid = d.payments.paid.reduce((s, v) => s + v.paid, 0);
    const stars = d.payments.paid.reduce((s, v) => s + v.stars, 0);
    const reportDate = date(d.generated_at);
    $("mon-message").textContent = `Отчёт: ${reportDate}. ${d.backfill_pending ? "Восстанавливается история: итоги пока неполные. " : ""}${!runtime.storage_ok ? "Сбор метрик временно недоступен. " : ""}`;
    const issues = runtime.issues;
    $("mon-content").innerHTML = `<div class="health ${issues.length ? "warning" : "healthy"}"><strong>${issues.length ? "Требует внимания" : "Система работает"}</strong><span>Версия ${esc(runtime.version)} · работает ${age(runtime.uptime_sec)}</span>${issues.length ? `<ul>${issues.map(i => `<li>${esc(issueLabels[i] || i)}</li>`).join("")}</ul>` : ""}</div>
      <div class="metrics">${tile("Всего игроков", n(players.total))}${tile("Новые игроки", n(registrations), "За выбранные календарные дни")}${tile("Активные сегодня", n(d.active.day), "С запуска мониторинга, UTC")}${tile("Открытия карт", n((events.drop || 0) + (events.extra_roll_used || 0)), "За выбранный период")}</div>
      ${section("Игроки", `<div class="metrics">${tile("Активные за 7 дней", n(d.active.week))}${tile("Активные за 30 дней", n(d.active.month))}${tile("Недавно в игре", n(d.active.online_5m), "Активность за 5 минут, приблизительно")}${tile("Действующий VIP", n(players.vip))}${tile("Вернувшиеся", n(d.active.returning), "Была активность до выбранного периода")}</div><div class="charts">${chart("Активные пользователи", d.activity_series, d.start, d.days)}${chart("Новые регистрации", d.registrations, d.start, d.days)}</div>`, `Посещения считаются по авторизованным запросам игры и обновлениям бота с ${date(d.telemetry_started_at)}. Админские отчёты исключены. Исторические игровые события показаны отдельно ниже.`)}
      ${section("Игровые действия", table(["Действие", "За период", "Предыдущий период"], d.events.map(e => [labels[e.kind] || e.kind, n(e.count), n(previous[e.kind] || 0)])) + chart("Открытия карт по дням", d.series, d.start, d.days), "Сравнение с предыдущими календарными днями той же длины. Сегодняшний день неполный. Распыление считается в операциях, не в картах.")}
      ${section("Редкости выпадений", table(["Источник", "Редкость", "Карт", "Доля в источнике"], d.rarities.map(r => {const total = d.rarities.filter(x => x.source === r.source).reduce((s, x) => s + x.count, 0); return [labels[r.source], r.rarity, n(r.count), `${n(r.count / total * 100)}%`];})), "Фактические доли по записанным открытиям. Объём выборки указан в колонке «Карт».")}
      ${section("Ресурсы", `<div class="metrics">${["dust", "crystals", "rolls"].map(c => tile(currency[c], n(players[c]), "Текущий суммарный остаток")).join("")}</div>` + table(["Ресурс", "Операция", "Начислено", "Потрачено"], d.economy.map(r => [currency[r.currency], labels[r.reason] || r.reason, n(r.incoming), n(r.outgoing)])), "Начисления администратора выделены отдельными строками. Резерв и возврат ставок — движение ресурсов, а не производство и уничтожение валюты.")}
      ${section("Telegram Stars", `<div class="metrics">${tile("Создано счетов", n(d.payments.created.reduce((s, v) => s + v.created, 0)))}${tile("Оплачено", n(paid), "По времени успешной оплаты")}${tile("Получено Stars", n(stars))}${tile("Начислено кристаллов", n(d.payments.paid.reduce((s, v) => s + v.crystals, 0)))}</div>`, "Созданные и оплаченные счета сгруппированы по разным датам; их отношение не является конверсией. Неоплаченные счета не считаются сбоями.")}
      ${section("Скорость и ошибки", table(["Операция", "Запросов", "Среднее, мс", "p95 ≤ мс", "5xx", "4xx", "401/403"], d.traffic.map(r => [r.route, n(r.count), n(r.mean_ms), r.p95_upper_ms == null ? "> 60 000" : n(r.p95_upper_ms), n(r.errors), n(r.rejected), n(r.auth_errors)])), "p95 — верхняя граница интервала гистограммы, а не точное измерение. 4xx — отказы запроса, включая игровые ограничения; 5xx — технические ошибки. Ожидание long polling Telegram не включено в скорость.")}
      ${section("Последние группы ошибок", table(["Источник", "Тип", "Повторов", "Последний раз UTC"], d.errors.map(e => [e.source, e.kind, n(e.count), date(e.last_at)])), "Сохраняются типы исключений без текста сообщений, токенов и содержимого запросов.")}
      ${section("VPS и процесс", `<div class="metrics">${tile("CPU процесса", `${n(system.process_cpu_percent)}%`, "100% = одно ядро")}${tile("Память процесса", bytes(system.rss_bytes))}${tile("Свободно на диске", bytes(system.disk_free_bytes))}${tile("Размер game.db", bytes(system.game_db_bytes))}${tile("Свободная RAM VPS", bytes(system.host_memory_available_bytes))}${tile("Load average VPS", system.load_average?.map(n).join(" / ") || "—", "За 1 / 5 / 15 минут")}${tile("Последняя копия БД", age(system.backup_age_sec), system.backup_age_sec == null ? "Резервная копия не найдена" : "Возраст")}${tile("Потерянные замеры", n(runtime.dropped_samples), "При переполнении очереди или сбое записи")}${tile("Последний запуск", date(runtime.started_at))}${tile("Ответ polling Telegram", runtime.last_poll_at ? date(runtime.last_poll_at) : "Ожидается")}</div>` + systemChart(d.system_series) + table(["Задача", "Последний результат", "Время UTC"], Object.entries(runtime.tasks).map(([name, task]) => [name, task.ok ? "Успешно" : "Ошибка", date(task.at)])), `Системный снимок: ${snap.at ? date(snap.at) : "ожидается"}. Linux показывает RAM и load average; на других ОС часть значений недоступна. История нагрузки сохраняется в monitoring.db.`)}
      ${section("Очередь уведомлений", `<div class="metrics">${tile("Ожидают", n(q.pending || 0))}${tile("Отправляются", n(q.sending || 0))}${tile("Повторные попытки", n(q.retries || 0))}${tile("Не доставлены", n(q.failed || 0))}${tile("Самое старое готовое", age(q.oldest_age_sec || 0))}</div>`)}
      ${section("Историческая активность", chart("Игроки с игровыми событиями", d.historical_activity, d.start, d.days), "Восстановлено из журнала игровых операций. Не включает простые посещения и административные начисления; отличается от показателя активных пользователей.")}`;
    requestAnimationFrame(updateScrollableTables);
  }
  let loading = false, controller;
  async function request(path) {
    const initData = tg?.initData;
    if (!initData) throw new Error("Откройте панель кнопкой /monitor или /admin в Telegram.");
    controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${api}${path}?days=${$("mon-days").value}`, {headers: {Authorization: `tma ${initData}`}, cache: "no-store", signal: controller.signal});
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Сервер недоступен (${response.status}).`);
      }
      return response;
    } finally { clearTimeout(timer); }
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    $("mon-days").disabled = true;
    $("mon-refresh").disabled = true;
    $("mon-message").textContent = "Обновление…";
    try { render(await (await request("/api/monitoring/report")).json()); }
    catch (error) { $("mon-message").textContent = error.name === "AbortError" ? "Сервер не ответил за 20 секунд. Повторите обновление." : error.message; }
    finally { loading = false; $("mon-refresh").disabled = false; $("mon-days").disabled = false; }
  }
  $("mon-back").onclick = () => {const url = new URL(location.href); url.searchParams.delete("monitor"); location.assign(url.href);};
  $("mon-refresh").onclick = refresh;
  $("mon-days").onchange = refresh;
  $("mon-export").onclick = async () => {
    if (loading) return;
    loading = true;
    $("mon-days").disabled = true;
    $("mon-export").disabled = true;
    try {
      const blob = await (await request("/api/monitoring/export")).blob();
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = "chizu-monitoring.csv"; root.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      $("mon-message").textContent = "CSV подготовлен. Если Telegram не сохраняет файл, откройте панель в Telegram Desktop.";
    } catch (error) { $("mon-message").textContent = error.message; }
    finally { loading = false; $("mon-export").disabled = false; $("mon-days").disabled = false; }
  };
  const timer = setInterval(() => {
    if (!document.activeElement?.closest(".table-scroll")) refresh();
  }, 60000);
  window.addEventListener("resize", updateScrollableTables);
  document.addEventListener("visibilitychange", () => { if (document.hidden) controller?.abort(); else refresh(); });
  window.addEventListener("pagehide", () => {clearInterval(timer); controller?.abort();}, {once: true});
  refresh();
})();
