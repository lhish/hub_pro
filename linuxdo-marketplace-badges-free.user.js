// ==UserScript==
// @name         Linux.do Hub Marketplace Native Filter
// @namespace    https://hub.linux.do/
// @version      2.8.1
// @description  用原页面列表样式筛选 Channel Hub 的 Badges、Free、模型关键字和热门度
// @match        https://hub.linux.do/marketplace*
// @match        https://hub.linux.do/marketplace/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

const __TEST__ = {
  isChannelsGraphqlBody(body) {
    try {
      const payload = typeof body === "string" ? JSON.parse(body) : body;
      const query = String(payload?.query || "");
      return /\bchannels\s*\(/.test(query) && !/\bmarketplaceModels\b|\bmarketplaceModel\b/.test(query);
    } catch {
      return false;
    }
  },
  buildAuthHeaders(token) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  },
  channelBadges(channel) {
    const badges = [];
    if (channel?.usesOfficialBaseURL) badges.push("Official");
    if (channel?.settings?.codingAgentMode === "broad") badges.push("Broad");
    if (channel?.settings?.codingAgentMode === "strict") badges.push("Strict");
    if (channel?.type) badges.push(channel.type);
    return [...new Set(badges)];
  },
  collectBadgeOptions(channels) {
    const priority = ["Official", "Broad", "Strict"];
    const values = new Set();
    for (const channel of channels || []) {
      for (const badge of this.channelBadges(channel)) values.add(badge);
    }
    return Array.from(values).sort((a, b) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
      return a.localeCompare(b);
    });
  },
  badgesMatch(actualBadges, selectedBadges) {
    return !selectedBadges.length || selectedBadges.some((badge) => actualBadges.includes(badge));
  },
  tagMatches(channel, tag) {
    switch (tag || "all") {
      case "official":
        return Boolean(channel?.usesOfficialBaseURL);
      case "third_party":
        return !channel?.usesOfficialBaseURL;
      case "client_restricted":
        return channel?.settings?.codingAgentMode === "broad" || channel?.settings?.codingAgentMode === "strict";
      case "strict_client_restricted":
        return channel?.settings?.codingAgentMode === "strict";
      default:
        return true;
    }
  },
  isFreeChannel(channel) {
    const prices = channel?.channelModelPrices || [];
    if (prices.length === 0) return true;
    return prices.every((modelPrice) =>
      (modelPrice?.price?.items || []).every((item) => {
        const value = Number.parseFloat(item?.pricing?.usagePerUnit);
        return !Number.isFinite(value) || value <= 0;
      }),
    );
  },
  channelMatches(channel, state) {
    return this.tagMatches(channel, state.tag)
      && this.badgesMatch(this.channelBadges(channel), state.badges || [])
      && (!state.free || this.isFreeChannel(channel))
      && this.modelKeywordMatch(channel, state.modelKeyword || "");
  },
  scriptOnlyChannelMatches(channel, state) {
    return this.badgesMatch(this.channelBadges(channel), state.badges || [])
      && (!state.free || this.isFreeChannel(channel))
      && this.modelKeywordMatch(channel, state.modelKeyword || "");
  },
  modelKeywordMatch(channel, keyword) {
    const text = String(keyword || "").trim().toLowerCase();
    if (!text) return true;
    return (channel?.supportedModels || []).some((model) => String(model).toLowerCase().includes(text));
  },
  popularityScore(probe) {
    return (probe?.points || []).reduce((sum, point) => {
      const value = Number(point?.successRequestCount);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0);
  },
  sortEdgesByPopularity(edges, scoreMap) {
    return [...edges].sort((a, b) => {
      const diff = (scoreMap.get(b?.node?.id) || 0) - (scoreMap.get(a?.node?.id) || 0);
      if (diff !== 0) return diff;
      return String(a?.node?.name || "").localeCompare(String(b?.node?.name || ""));
    });
  },
  sortEdgesByScriptSort(edges, state, scoreMap) {
    const sorted = [...edges];
    return sorted.sort((a, b) => {
      switch (state.sort || "created_desc") {
        case "popular_desc": {
          const diff = (scoreMap.get(b?.node?.id) || 0) - (scoreMap.get(a?.node?.id) || 0);
          if (diff !== 0) return diff;
          return String(a?.node?.name || "").localeCompare(String(b?.node?.name || ""));
        }
        case "consumed_desc":
          return (b.node?.budgetStats?.consumedAmount || 0) - (a.node?.budgetStats?.consumedAmount || 0);
        case "consumed_asc":
          return (a.node?.budgetStats?.consumedAmount || 0) - (b.node?.budgetStats?.consumedAmount || 0);
        case "models_desc":
          return (b.node?.supportedModels?.length || 0) - (a.node?.supportedModels?.length || 0);
        case "name_asc":
          return String(a.node?.name || "").localeCompare(String(b.node?.name || ""));
        case "created_desc":
        default:
          return new Date(b.node?.createdAt || 0).getTime() - new Date(a.node?.createdAt || 0).getTime();
      }
    });
  },
  isRenderedChannelEntry(entry) {
    return entry?.providerLabel != null
      && Array.isArray(entry?.node?.supportedModels)
      && "usesOfficialBaseURL" in entry.node;
  },
  shouldKeepFullRenderedSlice(source, result) {
    return Array.isArray(source)
      && Array.isArray(result)
      && source.length > result.length
      && (this.isRenderedChannelEntry(source[0]) || this.isRenderedChannelEntry(source[source.length - 1]));
  },
  nextDefaultChannelSelectionState({ alreadySelected, channelTabExists, channelActive }) {
    if (!channelTabExists) return { shouldClick: false, selected: Boolean(alreadySelected && channelActive) };
    if (channelActive) return { shouldClick: false, selected: true };
    return { shouldClick: true, selected: false };
  },
  isLikelyPaginationText(text) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (!normalized) return false;
    if (/Search|Channel Tags|Sort|筛选|搜索|排序|标签/i.test(normalized)) return false;
    return /Previous|Next|Prev\b|Page\s*\d|上一页|下一页|分页|加载更多/i.test(normalized);
  },
  filterChannelsPayload(payload, state, scoreMap = new Map()) {
    const channels = payload?.data?.channels;
    if (!channels?.edges) return payload;
    const matchedEdges = channels.edges.filter((edge) => this.channelMatches(edge.node, state));
    const nextEdges = this.sortEdgesByScriptSort(matchedEdges, state, scoreMap);
    return {
      ...payload,
      data: {
        ...payload.data,
        channels: {
          ...channels,
          edges: nextEdges,
          totalCount: nextEdges.length,
        },
      },
    };
  },
};

(function () {
  "use strict";

  const STATE_KEY = "ld_marketplace_native_filter_state";
  const BADGES_KEY = "ld_marketplace_native_filter_badges";
  const CHANNELS_KEY = "ld_marketplace_native_filter_channels";
  const PANEL_ID = "ld-native-marketplace-filter";
  const MODEL_TOOLTIP_ID = "ld-model-tooltip";
  const STYLE_ID = "ld-native-marketplace-filter-style";
  const GRAPHQL_PATH = "/admin/graphql";
  const POPULAR_SORT = "popular_desc";
  const NATIVE_SORT = "native";
  const PAGE_SIZE = 100;
  const MAX_SCAN_PAGES = 80;
  const PROBE_CHUNK_SIZE = 200;
  const PRICE_FIELDS = `
            channelModelPrices {
              modelID
              price {
                items {
                  itemCode
                  pricing {
                    usagePerUnit
                  }
                }
              }
            }
  `;
  const PROBE_QUERY = `
    query GetChannelProbeData($input: GetChannelProbeDataInput!) {
      channelProbeData(input: $input) {
        channelID
        points {
          successRequestCount
        }
      }
    }
  `;

  const defaultState = { tag: "all", badges: [], free: true, sort: "created_desc", modelKeyword: "" };
  const popularityScores = new Map();
  const knownChannels = new Map();
  const knownChannelsByName = new Map();
  const nativeFetch = window.fetch.bind(window);
  const nativeArrayFilter = Array.prototype.filter;
  const nativeArraySort = Array.prototype.sort;
  const nativeArraySlice = Array.prototype.slice;
  let uiFrame = 0;
  let tooltipBound = false;
  let nativeInputListenerAttached = false;
  let triggeringNativeRerender = false;
  let defaultChannelSelected = false;
  let defaultChannelClickTimer = 0;
  const hiddenNativeControls = new Set();
  const hiddenNativePagination = new Set();
  patchDomMutationSafety();
  patchArrayFiltering();
  window.fetch = patchedFetch;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || "{}");
      return {
        tag: typeof saved.tag === "string" ? saved.tag : "all",
        badges: Array.isArray(saved.badges) ? saved.badges : [],
        free: saved.free !== false,
        sort: typeof saved.sort === "string" ? saved.sort : "created_desc",
        modelKeyword: typeof saved.modelKeyword === "string" ? saved.modelKeyword : "",
      };
    } catch {
      return { ...defaultState };
    }
  }

  function saveState(state) {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  function loadBadgeOptions() {
    try {
      const values = JSON.parse(sessionStorage.getItem(BADGES_KEY) || "[]");
      return Array.isArray(values) ? values : [];
    } catch {
      return [];
    }
  }

  function loadKnownChannels() {
    try {
      const values = JSON.parse(sessionStorage.getItem(CHANNELS_KEY) || "[]");
      if (!Array.isArray(values)) return;
      for (const channel of values) {
        rememberChannel(channel);
      }
    } catch {
      // ignore invalid cache
    }
  }

  function saveKnownChannels() {
    sessionStorage.setItem(CHANNELS_KEY, JSON.stringify(Array.from(knownChannels.values()).map((channel) => ({
      id: channel.id,
      name: channel.name,
      supportedModels: channel.supportedModels || [],
    }))));
  }

  function saveBadgeOptions(options) {
    sessionStorage.setItem(BADGES_KEY, JSON.stringify(options));
  }

  function stateSignature() {
    return JSON.stringify({ state: loadState(), badges: loadBadgeOptions(), layout: controlsSignature() });
  }

  async function patchedFetch(input, init) {
    const requestInfo = getRequestInfo(input, init);
    if (!requestInfo.shouldHandle) return nativeFetch(input, init);

    try {
      return await buildFullChannelsResponse(requestInfo, init);
    } catch (error) {
      console.warn("[Linux.do Marketplace Filter] full channel scan failed, falling back to current request", error);
      const response = await nativeFetch(requestInfo.url, buildGraphqlInit(requestInfo, init, {
        ...requestInfo.body,
        query: ensurePriceFields(requestInfo.body.query),
      }));
      return wrapGraphqlResponse(response, requestInfo);
    }
  }

  function getRequestInfo(input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const bodyText = typeof init?.body === "string" ? init.body : "";
    const headers = new Headers(init?.headers || input?.headers || {});
    headers.set("Content-Type", "application/json");
    headers.delete("content-length");
    return {
      shouldHandle: url.includes(GRAPHQL_PATH) && __TEST__.isChannelsGraphqlBody(bodyText),
      body: bodyText ? JSON.parse(bodyText) : {},
      headers,
      method: init?.method || input?.method || "POST",
      credentials: init?.credentials || input?.credentials || "same-origin",
      url,
    };
  }

  function ensurePriceFields(query) {
    if (!query || /channelModelPrices\s*\{/.test(query)) return query;
    const withUserInsert = query.replace(/(user\s*\{[\s\S]*?linuxdoUsername\s*\})/, `$1\n${PRICE_FIELDS}`);
    if (withUserInsert !== query) return withUserInsert;
    return query.replace(/(settings\s*\{[\s\S]*?codingAgentMode\s*\})/, `$1\n${PRICE_FIELDS}`);
  }

  function buildGraphqlInit(requestInfo, init, body) {
    return {
      ...init,
      method: requestInfo.method,
      credentials: requestInfo.credentials,
      headers: requestInfo.headers,
      body: JSON.stringify(body),
    };
  }

  async function buildFullChannelsResponse(requestInfo, init) {
    const query = ensurePriceFields(requestInfo.body.query);
    const baseVariables = requestInfo.body.variables || {};
    const allEdges = [];
    let after = baseVariables.after || null;
    let lastPayload = null;
    let lastResponse = null;

    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const body = {
        ...requestInfo.body,
        query,
        variables: {
          ...baseVariables,
          first: Math.max(Number(baseVariables.first) || PAGE_SIZE, PAGE_SIZE),
          after,
        },
      };
      lastResponse = await nativeFetch(requestInfo.url, buildGraphqlInit(requestInfo, init, body));
      lastPayload = await lastResponse.clone().json();
      rememberBadges(lastPayload);
      rememberChannels(lastPayload);

      const channels = lastPayload?.data?.channels;
      if (!channels?.edges) return lastResponse;
      allEdges.push(...channels.edges);
      if (!channels.pageInfo?.hasNextPage || !channels.pageInfo.endCursor) break;
      after = channels.pageInfo.endCursor;
    }

    const combinedPayload = combineChannelsPayload(lastPayload, allEdges);
    if (loadState().sort === POPULAR_SORT) {
      await fetchPopularityScores(allEdges.map((edge) => edge.node.id), requestInfo);
    }
    rememberChannels(combinedPayload);
    return responseFromPayload(lastResponse, combinedPayload);
  }

  function combineChannelsPayload(payload, edges) {
    const channels = payload?.data?.channels;
    if (!channels) return payload;
    return {
      ...payload,
      data: {
        ...payload.data,
        channels: {
          ...channels,
          edges,
          totalCount: edges.length,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: edges[0]?.cursor || null,
            endCursor: edges[edges.length - 1]?.cursor || null,
          },
        },
      },
    };
  }

  async function fetchPopularityScores(channelIDs, requestInfo) {
    const ids = Array.from(new Set(channelIDs.filter(Boolean)));
    for (let index = 0; index < ids.length; index += PROBE_CHUNK_SIZE) {
      const chunk = ids.slice(index, index + PROBE_CHUNK_SIZE);
      const response = await nativeFetch(requestInfo.url, buildGraphqlInit(requestInfo, undefined, {
        query: PROBE_QUERY,
        variables: { input: { channelIDs: chunk } },
      }));
      const payload = await response.json();
      for (const item of payload?.data?.channelProbeData || []) {
        popularityScores.set(item.channelID, __TEST__.popularityScore(item));
      }
    }
  }

  function responseFromPayload(response, payload) {
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json");
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  function wrapGraphqlResponse(response, requestInfo) {
    return new Proxy(response, {
      get(target, prop) {
        if (prop === "json") {
          return async () => {
            const payload = await target.clone().json();
            rememberBadges(payload);
            rememberChannels(payload);
            const edges = payload?.data?.channels?.edges || [];
            if (loadState().sort === POPULAR_SORT) {
              await fetchPopularityScores(edges.map((edge) => edge.node.id), requestInfo);
            }
            return payload;
          };
        }
        const value = target[prop];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }

  function patchArrayFiltering() {
    if (!Array.prototype.filter.__ldMarketplacePatched) {
      const patchedFilter = function (callback, thisArg) {
        const result = nativeArrayFilter.call(this, callback, thisArg);
        if (!isRenderedChannelEntryArray(this) && !isRenderedChannelEntryArray(result)) return result;
        const state = loadState();
        return nativeArrayFilter.call(result, (entry) => __TEST__.scriptOnlyChannelMatches(entry.node, state));
      };
      patchedFilter.__ldMarketplacePatched = true;
      Array.prototype.filter = patchedFilter;
    }

    if (!Array.prototype.sort.__ldMarketplacePatched) {
      const patchedSort = function (compareFn) {
        if (isRenderedChannelEntryArray(this)) {
          return nativeArraySort.call(this, (a, b) => {
            const sorted = __TEST__.sortEdgesByScriptSort([{ node: a.node }, { node: b.node }], loadState(), popularityScores);
            return sorted[0]?.node === a.node ? -1 : 1;
          });
        }
        return nativeArraySort.call(this, compareFn);
      };
      patchedSort.__ldMarketplacePatched = true;
      Array.prototype.sort = patchedSort;
    }

    if (!Array.prototype.slice.__ldMarketplacePatched) {
      const patchedSlice = function (start, end) {
        const result = nativeArraySlice.call(this, start, end);
        if (__TEST__.shouldKeepFullRenderedSlice(this, result)) return nativeArraySlice.call(this, 0);
        return result;
      };
      patchedSlice.__ldMarketplacePatched = true;
      Array.prototype.slice = patchedSlice;
    }
  }

  function patchDomMutationSafety() {
    const nativeRemoveChild = Node.prototype.removeChild;
    if (nativeRemoveChild.__ldMarketplacePatched) return;
    const patchedRemoveChild = function (child) {
      if (child?.parentNode !== this) return child;
      return nativeRemoveChild.call(this, child);
    };
    patchedRemoveChild.__ldMarketplacePatched = true;
    Node.prototype.removeChild = patchedRemoveChild;
  }

  function isRenderedChannelEntryArray(value) {
    if (!Array.isArray(value) || value.length === 0 || value.length > 10000) return false;
    const first = value[0];
    const last = value[value.length - 1];
    return isRenderedChannelEntry(first) || isRenderedChannelEntry(last);
  }

  function isRenderedChannelEntry(entry) {
    return __TEST__.isRenderedChannelEntry(entry);
  }

  function rememberBadges(payload) {
    const edges = payload?.data?.channels?.edges || [];
    const current = new Set(loadBadgeOptions());
    for (const option of __TEST__.collectBadgeOptions(edges.map((edge) => edge.node))) current.add(option);
    saveBadgeOptions(Array.from(current).sort((a, b) => a.localeCompare(b)));
    queueMicrotask(renderPanel);
  }

  function rememberChannels(payload) {
    const edges = payload?.data?.channels?.edges || [];
    for (const edge of edges) {
      const channel = edge?.node;
      rememberChannel({
        id: channel.id,
        name: channel.name || "",
        supportedModels: channel.supportedModels || [],
      });
    }
    saveKnownChannels();
    queueMicrotask(bindModelTooltipEvents);
  }

  function rememberChannel(channel) {
    if (!channel?.id) return;
    knownChannels.set(channel.id, channel);
    if (channel.name) knownChannelsByName.set(channel.name, channel);
  }

  function isChannelHubActive() {
    const selected = document.querySelector('[role="tab"][aria-selected="true"], [role="tab"][data-state="active"]');
    return /channel hub|渠道/i.test(String(selected?.textContent || ""));
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${PANEL_ID} {
        display: contents;
      }
      #${PANEL_ID} .ld-label {
        display: block;
        margin-bottom: 4px;
        color: hsl(var(--muted-foreground, 215 16% 47%));
        font-size: 12px;
        font-weight: 600;
        line-height: 1;
        text-transform: uppercase;
        letter-spacing: .025em;
      }
      #${PANEL_ID} .ld-control-wrap {
        position: relative;
      }
      #${PANEL_ID} .ld-field,
      #${PANEL_ID} .ld-extra-field {
        position: relative;
        min-width: 0;
      }
      #${PANEL_ID} input[type="search"],
      #${PANEL_ID} button,
      #${PANEL_ID} summary {
        height: 36px;
        border: 1px solid hsl(var(--input, 214 32% 91%));
        border-radius: 6px;
        background: #fff;
        color: #0f172a;
        font-size: 14px;
        box-shadow: 0 1px 2px rgba(15, 23, 42, .04);
      }
      #${PANEL_ID} summary {
        display: inline-flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        width: 100%;
        padding: 0 12px;
      }
      #${PANEL_ID} summary::after {
        content: "⌄";
        color: #64748b;
        font-size: 14px;
        line-height: 1;
        transform: translateY(-1px);
      }
      #${PANEL_ID} input[type="search"] {
        width: 100%;
        padding: 0 10px;
        outline: none;
      }
      #${PANEL_ID} .ld-control {
        display: inline-flex;
        align-items: center;
        width: 100%;
        height: 36px;
        border: 1px solid hsl(var(--input, 214 32% 91%));
        border-radius: 6px;
        background: #fff;
        color: #0f172a;
        padding: 0 10px;
        font-size: 14px;
      }
      #${PANEL_ID} select {
        width: 100%;
        padding: 0 32px 0 10px;
      }
      #${PANEL_ID} summary {
        cursor: pointer;
        list-style: none;
      }
      #${PANEL_ID} summary::-webkit-details-marker {
        display: none;
      }
      #${PANEL_ID} .ld-summary-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #${PANEL_ID} .ld-menu {
        position: absolute;
        z-index: 999998;
        top: calc(100% + 4px);
        left: 0;
        width: min(320px, 90vw);
        max-height: 280px;
        overflow: auto;
        border: 1px solid hsl(var(--border, 214 32% 91%));
        border-radius: 8px;
        background-color: #fff !important;
        color: #0f172a !important;
        box-shadow: 0 12px 30px rgba(15, 23, 42, .16);
        padding: 6px;
      }
      #${PANEL_ID} .ld-option {
        display: flex;
        align-items: center;
        gap: 8px;
        border-radius: 6px;
        padding: 7px 8px;
        font-size: 13px;
        line-height: 1.2;
        background-color: #fff !important;
      }
      #${PANEL_ID} .ld-option input {
        margin: 0;
      }
      #${PANEL_ID} .ld-separator {
        height: 1px;
        margin: 6px 4px;
        background: #e2e8f0;
      }
      #${PANEL_ID} button {
        width: 100%;
        padding: 0 10px;
        cursor: pointer;
      }
      #${PANEL_ID} button:hover,
      #${PANEL_ID} summary:hover,
      #${PANEL_ID} .ld-option:hover {
        background: #f1f5f9;
      }
      #${MODEL_TOOLTIP_ID} {
        position: fixed;
        z-index: 999999;
        border: 1px solid hsl(var(--border, 214 32% 91%));
        border-radius: 8px;
        background-color: #fff !important;
        color: #0f172a !important;
        box-shadow: 0 12px 30px rgba(15, 23, 42, .18);
        padding: 8px;
        font-size: 12px;
        line-height: 1.45;
        white-space: normal;
        pointer-events: none;
      }
      #${MODEL_TOOLTIP_ID} .ld-model-tooltip-title {
        margin-bottom: 6px;
        padding: 2px 4px 6px;
        border-bottom: 1px solid hsl(var(--border, 214 32% 91%));
        background-color: #fff !important;
        font-weight: 600;
      }
      #${MODEL_TOOLTIP_ID} .ld-model-item {
        margin: 2px 0;
        padding: 3px 4px;
        border-radius: 4px;
        background-color: #f1f5f9 !important;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      }
    `;
    document.head.appendChild(style);
  }

  function renderPanel() {
    if (!document.body) return;
    preferChannelHub();
    cancelAnimationFrame(uiFrame);
    uiFrame = requestAnimationFrame(renderPanelNow);
  }

  function preferChannelHub() {
    const tablist = document.querySelector('[role="tablist"]');
    if (!tablist) return;
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    const channelTab = tabs.find((tab) => /channel hub|渠道/i.test(String(tab.textContent || "")));
    const modelTab = tabs.find((tab) => /model hub|模型/i.test(String(tab.textContent || "")));
    if (channelTab && modelTab) {
      channelTab.style.order = "0";
      modelTab.style.order = "1";
    }
    const nextSelection = __TEST__.nextDefaultChannelSelectionState({
      alreadySelected: defaultChannelSelected,
      channelTabExists: Boolean(channelTab),
      channelActive: isTabActive(channelTab),
    });
    defaultChannelSelected = nextSelection.selected;
    if (nextSelection.shouldClick && channelTab && !defaultChannelClickTimer) {
      defaultChannelClickTimer = setTimeout(() => {
        defaultChannelClickTimer = 0;
        channelTab.click();
        setTimeout(renderPanel, 60);
      }, 0);
    }
  }

  function isTabActive(tab) {
    return Boolean(tab)
      && (/true/.test(String(tab.getAttribute("aria-selected"))) || tab.getAttribute("data-state") === "active");
  }

  function renderPanelNow() {
    const existing = document.getElementById(PANEL_ID);
    if (!isChannelHubActive()) {
      existing?.remove();
      restoreNativeFields();
      restoreNativePagination();
      return;
    }
    ensureStyle();
    const controls = findNativeControls();
    if (!controls.grid || !controls.tags || !controls.sort) return;
    const panel = existing || document.createElement("div");
    const signature = stateSignature();
    panel.id = PANEL_ID;
    if (panel.dataset.signature !== signature) {
      panel.innerHTML = panelHtml();
      panel.dataset.signature = signature;
    }
    if (!existing || panel.parentElement !== controls.grid || panel.previousElementSibling !== controls.tags) {
      controls.tags.insertAdjacentElement("afterend", panel);
    }
    placePanelFields(panel, controls);
    panel.onchange = handlePanelChange;
    panel.onclick = handlePanelClick;
    panel.oninput = handlePanelInput;
    hideNativePagination();
    attachNativeSearchListener();
    bindModelTooltipEvents();
  }

  function findPanelAnchor() {
    const bars = Array.from(document.querySelectorAll("div[class*='rounded-lg'][class*='border'][class*='p-3']"));
    return bars.find((element) => {
      const text = String(element.textContent || "");
      return /Search|搜索/i.test(text) && /Sort|排序/i.test(text);
    });
  }

  function findNativeControls() {
    const anchor = findPanelAnchor();
    const fields = Array.from(anchor?.querySelectorAll("div") || []);
    const grid = Array.from(anchor?.children || []).find((child) => String(child.className || "").includes("grid"));
    return {
      anchor,
      grid,
      tags: fields.find((field) => /Channel Tags|Tags|渠道标签|标签/i.test(String(field.querySelector("p")?.textContent || ""))),
      sort: fields.find((field) => /Sort|排序/i.test(String(field.querySelector("p")?.textContent || ""))),
    };
  }

  function controlsSignature() {
    const controls = findNativeControls();
    return [controls.tags, controls.sort].map((element) => {
      if (!element) return "";
      const rect = element.getBoundingClientRect();
      return `${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}`;
    }).join("|");
  }

  function placePanelFields(panel, controls) {
    hideNativeField(controls.tags);
    hideNativeField(controls.sort);
  }

  function hideNativeField(field) {
    if (!field || hiddenNativeControls.has(field)) return;
    field.style.display = "none";
    hiddenNativeControls.add(field);
  }

  function restoreNativeFields() {
    for (const element of hiddenNativeControls) element.style.display = "";
    hiddenNativeControls.clear();
  }

  function hideNativePagination() {
    restoreDetachedHiddenPagination();
    const candidates = Array.from(document.querySelectorAll("nav, ul, div"));
    for (const element of candidates) {
      if (!isLikelyPaginationElement(element) || hiddenNativePagination.has(element)) continue;
      element.style.display = "none";
      hiddenNativePagination.add(element);
    }
  }

  function isLikelyPaginationElement(element) {
    if (!element || element.closest(`#${PANEL_ID}, #${MODEL_TOOLTIP_ID}`)) return false;
    const controls = Array.from(element.querySelectorAll("button, a, [role='button']"));
    if (controls.length < 2) return false;
    const labels = controls.map((control) => control.getAttribute("aria-label") || control.textContent || "");
    const text = [element.textContent || "", ...labels].join(" ");
    return __TEST__.isLikelyPaginationText(text);
  }

  function restoreNativePagination() {
    for (const element of hiddenNativePagination) element.style.display = "";
    hiddenNativePagination.clear();
  }

  function restoreDetachedHiddenPagination() {
    for (const element of Array.from(hiddenNativePagination)) {
      if (!document.documentElement.contains(element)) hiddenNativePagination.delete(element);
    }
  }

  function panelHtml() {
    const state = loadState();
    const selected = new Set(state.badges);
    const badges = loadBadgeOptions();
    const tagHtml = tagOptions().map((option) => `<label class="ld-option"><input type="radio" name="ld-tag" data-role="tag" value="${option.value}" ${state.tag === option.value ? "checked" : ""}> <span>${option.label}</span></label>`).join("");
    const badgeHtml = badges.length
      ? badges.map((badge) => `<label class="ld-option"><input type="checkbox" data-role="badge" value="${escapeHtml(badge)}" ${selected.has(badge) ? "checked" : ""}> <span>${escapeHtml(badge)}</span></label>`).join("")
      : `<div class="ld-option">等待列表加载 Badges</div>`;
    const tagLabel = tagOptions().find((option) => option.value === state.tag)?.label || "All";
    const selectedText = state.badges.length ? `${tagLabel} · ${state.badges.join(", ")}` : tagLabel;
    const sortLabel = sortOptions().find((option) => option.value === state.sort)?.label || "Newest";
    const sortHtml = sortOptions().map((option) => `<label class="ld-option"><input type="radio" name="ld-sort" data-role="sort" value="${option.value}" ${state.sort === option.value ? "checked" : ""}> <span>${option.label}</span></label>`).join("");
    return `
      <div class="ld-field" data-field="tags">
        <details>
          <summary><span class="ld-summary-text">${escapeHtml(selectedText)}</span></summary>
          <div class="ld-menu">${tagHtml}<div class="ld-separator"></div>${badgeHtml}</div>
        </details>
      </div>
      <div class="ld-field" data-field="sort">
        <details>
          <summary><span class="ld-summary-text">${escapeHtml(sortLabel)}</span></summary>
          <div class="ld-menu">${sortHtml}</div>
        </details>
      </div>
      <div class="ld-extra-field" data-field="free">
        <span class="ld-label">Free</span>
        <label class="ld-control"><input type="checkbox" data-role="free" ${state.free ? "checked" : ""}> <span style="margin-left:8px">只看 Free</span></label>
      </div>
      <div class="ld-extra-field" data-field="model">
        <span class="ld-label">模型</span>
        <input type="search" data-role="modelKeyword" value="${escapeHtml(state.modelKeyword || "")}" placeholder="筛选模型 ID">
      </div>
    `;
  }

  function tagOptions() {
    return [
      { value: "all", label: "All" },
      { value: "official", label: "Official" },
      { value: "third_party", label: "Third party" },
      { value: "client_restricted", label: "Client restricted" },
      { value: "strict_client_restricted", label: "Strict client restricted" },
    ];
  }

  function sortOptions() {
    return [
      { value: "created_desc", label: "Newest" },
      { value: "popular_desc", label: "热门度" },
      { value: "consumed_desc", label: "Most consumed" },
      { value: "consumed_asc", label: "Least consumed" },
      { value: "models_desc", label: "Most models" },
      { value: "multiplier_desc", label: "Highest multiplier" },
      { value: "multiplier_asc", label: "Lowest multiplier" },
      { value: "name_asc", label: "Name A-Z" },
    ];
  }

  function handlePanelChange(event) {
    const panel = event.currentTarget;
    const state = {
      tag: panel.querySelector('[data-role="tag"]:checked')?.value || "all",
      free: Boolean(panel.querySelector('[data-role="free"]')?.checked),
      badges: Array.from(panel.querySelectorAll('[data-role="badge"]:checked')).map((input) => input.value),
      sort: panel.querySelector('[data-role="sort"]:checked')?.value || "created_desc",
      modelKeyword: panel.querySelector('[data-role="modelKeyword"]')?.value || loadState().modelKeyword || "",
    };
    saveState(state);
    panel.dataset.signature = "";
    renderPanel();
    applyFiltersWithoutReload();
  }

  function handlePanelClick(event) {
    if (event.target?.dataset?.role !== "clear") return;
    saveState({ tag: "all", badges: [], free: false, sort: "created_desc", modelKeyword: "" });
    const panel = event.currentTarget;
    panel.dataset.signature = "";
    renderPanel();
    applyFiltersWithoutReload();
  }

  function handlePanelInput(event) {
    if (event.target?.dataset?.role !== "modelKeyword") return;
    const panel = event.currentTarget;
    const state = loadState();
    saveState({
      ...state,
      modelKeyword: event.target.value,
    });
    panel.dataset.signature = stateSignature();
    debounceApplyFilters();
  }

  let applyTimer = 0;
  function debounceApplyFilters() {
    clearTimeout(applyTimer);
    applyTimer = setTimeout(applyFiltersWithoutReload, 180);
  }

  function applyFiltersWithoutReload() {
    syncModelKeywordFromNativeSearch();
    triggerChannelHubRerender();
    queueMicrotask(bindModelTooltipEvents);
  }

  function triggerChannelHubRerender() {
    const input = findChannelSearchInput();
    if (!input) return;
    triggeringNativeRerender = true;
    const original = input.value;
    setNativeInputValue(input, `${original}\u200b`);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setTimeout(() => {
      setNativeInputValue(input, original);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      triggeringNativeRerender = false;
    }, 20);
  }

  function syncModelKeywordFromNativeSearch() {
    const input = findChannelSearchInput();
    if (!input) return;
    const state = loadState();
    const panelInput = document.querySelector(`#${PANEL_ID} [data-role="modelKeyword"]`);
    saveState({ ...state, modelKeyword: panelInput?.value || input.value || "" });
  }

  function attachNativeSearchListener() {
    if (nativeInputListenerAttached) return;
    nativeInputListenerAttached = true;
    document.addEventListener("input", (event) => {
      if (triggeringNativeRerender) return;
      if (event.target?.matches?.("input") && event.target.dataset.role !== "modelKeyword") {
        const input = findChannelSearchInput();
        if (event.target === input) debounceApplyFilters();
      }
    }, true);
  }

  function findChannelSearchInput() {
    const bars = Array.from(document.querySelectorAll("div[class*='rounded-lg'][class*='border'][class*='p-3']"));
    const bar = bars.find((element) => /Search|搜索/i.test(String(element.textContent || ""))
      && /Sort|排序/i.test(String(element.textContent || "")));
    if (!bar) return null;
    return Array.from(bar.querySelectorAll("input")).find((input) => input.dataset.role !== "modelKeyword") || null;
  }

  function setNativeInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
  }

  function bindModelTooltipEvents() {
    if (tooltipBound || !document.body) return;
    tooltipBound = true;
    loadKnownChannels();
    document.addEventListener("mousemove", handleModelTooltipMove, true);
    document.addEventListener("mouseleave", hideModelTooltip, true);
    window.addEventListener("scroll", hideModelTooltip, { passive: true });
  }

  function handleModelTooltipMove(event) {
    if (!isChannelHubActive()) return hideModelTooltip();
    const channel = channelFromHoverTarget(event.target);
    if (!channel) return hideModelTooltip();
    showModelTooltip(channel, event.clientX, event.clientY);
  }

  function channelFromHoverTarget(target) {
    loadKnownChannels();
    const element = target?.closest?.("p, h1, h2, h3, h4, span, div");
    if (!element || element.closest(`#${PANEL_ID}, #${MODEL_TOOLTIP_ID}`)) return null;
    if (element.children.length > 2) return null;
    const text = String(element.textContent || "").trim();
    if (!text) return null;
    const channel = knownChannelsByName.get(text);
    return channel?.supportedModels?.length ? channel : null;
  }

  function showModelTooltip(channel, clientX, clientY) {
    const tooltip = ensureModelTooltip();
    tooltip.innerHTML = modelTooltipHtml(channel);
    tooltip.hidden = false;
    const left = Math.min(clientX + 14, window.innerWidth - tooltip.offsetWidth - 12);
    const top = Math.min(clientY + 14, window.innerHeight - tooltip.offsetHeight - 12);
    tooltip.style.left = `${Math.max(12, left)}px`;
    tooltip.style.top = `${Math.max(12, top)}px`;
  }

  function hideModelTooltip() {
    const tooltip = document.getElementById(MODEL_TOOLTIP_ID);
    if (tooltip) tooltip.hidden = true;
  }

  function ensureModelTooltip() {
    let tooltip = document.getElementById(MODEL_TOOLTIP_ID);
    if (!tooltip) {
      tooltip = document.createElement("div");
      tooltip.id = MODEL_TOOLTIP_ID;
      tooltip.hidden = true;
      document.body.appendChild(tooltip);
    }
    return tooltip;
  }

  function modelTooltipHtml(channel) {
    const models = channel.supportedModels || [];
    const modelItems = models.map((model) => `<div class="ld-model-item">${escapeHtml(model)}</div>`).join("");
    return `
      <div class="ld-model-tooltip-title">${escapeHtml(channel.name)} · ${models.length} 模型</div>
      ${modelItems}
    `;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  const observer = new MutationObserver(renderPanel);
  function startUi() {
    renderPanel();
    bindModelTooltipEvents();
    window.addEventListener("resize", renderPanel, { passive: true });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startUi, { once: true });
  } else {
    startUi();
  }
})();
