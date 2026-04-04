// ==UserScript==
// @name         云端工坊面板
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  通过按钮事件打开内嵌云端工坊页面
// @author       Codex
// @match        */*
// @grant        none
// @noframes
// ==/UserScript==
!(async function () {
  "use strict";

  const SCRIPT_ID = "cloudflare_workshop_panel";
  const PANEL_ID = `${SCRIPT_ID}-panel`;
  const STYLE_ID = `${SCRIPT_ID}-styles`;
  const BRIDGE_SCRIPT_ID = `${SCRIPT_ID}-bridge-script`;
  const TARGET_URL = "https://cloudflare-workshop.saugrodep.workers.dev/?embed=1";
  const TARGET_ORIGIN = "https://cloudflare-workshop.saugrodep.workers.dev";
  const BUTTON_EVENT_NAME = "创意工坊";
  const MAX_WAIT_TIME = 30000;
  const CHECK_INTERVAL = 100;
  const WORLDBOOK_BRIDGE_CHANNEL = "creative-workshop:worldbook";
  const WORKSHOP_MOD_START_NAME = "--/Mod开始";
  const WORKSHOP_MOD_END_NAME = "--/Mod结束";
  const WORKSHOP_MOD_START_ORDER = 400;
  const WORKSHOP_MOD_END_ORDER = 500;
  let _lastToggleAt = 0;
  let _hostBootKey = "";

  try {
    if (window.location.origin === TARGET_ORIGIN) {
      console.log("[云端工坊面板] 检测到创意工坊页面自身，跳过宿主脚本初始化");
      return;
    }
  } catch (e) {}

  const getUiHost = () => {
    try {
      const win = window.parent && window.parent !== window ? window.parent : window;
      const doc = win.document || document;
      const $ = win.jQuery || win.$ || window.jQuery || window.$;
      return { window: win, document: doc, $ };
    } catch (e) {
      return { window, document, $: window.jQuery || window.$ };
    }
  };

  const getPageHost = () => ({
    window,
    document,
    $: window.jQuery || window.$,
  });

  const getPageHostCandidates = () => {
    const candidates = [];
    const pushCandidate = (win) => {
      try {
        if (win && !candidates.some((item) => item.window === win)) {
          candidates.push({
            window: win,
            document: win.document || document,
            $: win.jQuery || win.$ || window.jQuery || window.$,
          });
        }
      } catch (e) {}
    };
    pushCandidate(window);
    try { pushCandidate(window.parent); } catch (e) {}
    try { pushCandidate(window.top); } catch (e) {}
    return candidates;
  };

  const scorePageHost = (host) => {
    const win = host?.window;
    if (!win) return -1;
    let score = 0;
    try {
      const href = String(win.location?.href || "");
      // 移除对 srcdoc 的惩罚，因为酒馆API可能在srcdoc中
      // if (href === "about:srcdoc") score -= 100;
      if (typeof win.getCharWorldbookNames === "function") score += 10;
      if (typeof win.getWorldbook === "function") score += 10;
      if (typeof win.updateWorldbookWith === "function") score += 10;
      if (typeof win.createWorldbookEntries === "function") score += 10;
      if (typeof win.deleteWorldbookEntries === "function") score += 10;
      if (typeof win.getWorldbookNames === "function") score += 8;
      if (typeof win.getGlobalWorldbookNames === "function") score += 6;
      if (typeof win.getChatWorldbookName === "function") score += 6;
      if (typeof win.createWorldbook === "function") score += 6;
      if (typeof win.waitGlobalInitialized === "function") score += 4;
      if (win.TavernHelper) score += 4;
      if (href && href !== "about:srcdoc") score += 3;
    } catch (e) {}
    return score;
  };

  const resolvePageHost = () => {
    const candidates = getPageHostCandidates();
    const sorted = candidates
      .map((host) => ({ host, score: scorePageHost(host), href: String(host?.window?.location?.href || "") }))
      .sort((a, b) => b.score - a.score);
    const preferred = sorted.find((item) => item.href && item.href !== "about:srcdoc");
    return preferred?.host || sorted[0]?.host || getPageHost();
  };

  const hostCore = getUiHost();
  _hostBootKey = `${SCRIPT_ID}__booted`;
  if (hostCore.window[_hostBootKey]) {
    console.log("[云端工坊面板] 宿主脚本已初始化，跳过重复注入");
    return;
  }
  hostCore.window[_hostBootKey] = true;

  const log = {
    prefix: "[云端工坊面板]",
    info: (...args) => console.log(log.prefix, ...args),
    warn: (...args) => console.warn(log.prefix, ...args),
    error: (...args) => console.error(log.prefix, ...args),
  };

  const summarizeHost = (host) => {
    const win = host?.window;
    if (!win) return { href: "", score: -1 };
    return {
      href: String(win.location?.href || ""),
      hasWaitGlobalInitialized: typeof win.waitGlobalInitialized === "function",
      hasEventOn: typeof win.eventOn === "function",
      hasGetButtonEvent: typeof win.getButtonEvent === "function",
      hasToastr: typeof win.toastr !== "undefined",
      hasGetWorldbookNames: typeof win.getWorldbookNames === "function",
      hasGetGlobalWorldbookNames: typeof win.getGlobalWorldbookNames === "function",
      hasGetCharWorldbookNames: typeof win.getCharWorldbookNames === "function",
      hasGetChatWorldbookName: typeof win.getChatWorldbookName === "function",
      hasGetWorldbook: typeof win.getWorldbook === "function",
      hasUpdateWorldbookWith: typeof win.updateWorldbookWith === "function",
      hasCreateWorldbookEntries: typeof win.createWorldbookEntries === "function",
      hasDeleteWorldbookEntries: typeof win.deleteWorldbookEntries === "function",
      hasTavernHelper: !!win.TavernHelper,
    };
  };

  const pageBridgeBootstrap = (config) => {
    const bridgeBootKey = config.bootKey;
    if (window[bridgeBootKey]) return;
    window[bridgeBootKey] = true;

    const getTargetWindow = () => window;

    const summarizeApi = (api) => ({
      targetHref: api?.targetWindow?.location?.href || "",
      bridgeSource: api?.helper ? "TavernHelper" : "global",
      hasGetWorldbookNames: !!api?.getWorldbookNames,
      hasGetGlobalWorldbookNames: !!api?.getGlobalWorldbookNames,
      hasGetCharWorldbookNames: !!api?.getCharWorldbookNames,
      hasGetChatWorldbookName: !!api?.getChatWorldbookName,
      hasGetWorldbook: !!api?.getWorldbook,
      hasCreateWorldbook: !!api?.createWorldbook,
      hasCreateWorldbookEntries: !!api?.createWorldbookEntries,
      hasUpdateWorldbookWith: !!api?.updateWorldbookWith,
      hasDeleteWorldbookEntries: !!api?.deleteWorldbookEntries,
    });

    const getWorldbookApi = () => {
      const targetWindow = getTargetWindow();
      const helper = targetWindow.TavernHelper || null;
      
      // 直接从全局作用域获取函数（不通过window对象）
      // 因为这些函数在酒馆页面中是全局定义的
      const api = {
        targetWindow,
        helper,
        getWorldbookNames: typeof helper?.getWorldbookNames === "function"
          ? (...args) => helper.getWorldbookNames(...args)
          : (typeof getWorldbookNames === "function" ? getWorldbookNames : null),
        getGlobalWorldbookNames: typeof helper?.getGlobalWorldbookNames === "function"
          ? (...args) => helper.getGlobalWorldbookNames(...args)
          : (typeof getGlobalWorldbookNames === "function" ? getGlobalWorldbookNames : null),
        getCharWorldbookNames: typeof helper?.getCharWorldbookNames === "function"
          ? (...args) => helper.getCharWorldbookNames(...args)
          : (typeof getCharWorldbookNames === "function" ? getCharWorldbookNames : null),
        getChatWorldbookName: typeof helper?.getChatWorldbookName === "function"
          ? (...args) => helper.getChatWorldbookName(...args)
          : (typeof getChatWorldbookName === "function" ? getChatWorldbookName : null),
        getWorldbook: typeof helper?.getWorldbook === "function"
          ? (...args) => helper.getWorldbook(...args)
          : (typeof getWorldbook === "function" ? getWorldbook : null),
        createWorldbook: typeof helper?.createWorldbook === "function"
          ? (...args) => helper.createWorldbook(...args)
          : (typeof createWorldbook === "function" ? createWorldbook : null),
        createWorldbookEntries: typeof helper?.createWorldbookEntries === "function"
          ? (...args) => helper.createWorldbookEntries(...args)
          : (typeof createWorldbookEntries === "function" ? createWorldbookEntries : null),
        updateWorldbookWith: typeof helper?.updateWorldbookWith === "function"
          ? (...args) => helper.updateWorldbookWith(...args)
          : (typeof updateWorldbookWith === "function" ? updateWorldbookWith : null),
        deleteWorldbookEntries: typeof helper?.deleteWorldbookEntries === "function"
          ? (...args) => helper.deleteWorldbookEntries(...args)
          : (typeof deleteWorldbookEntries === "function" ? deleteWorldbookEntries : null),
      };
      
      return api;
    };

    console.log(config.logPrefix, "页面桥接启动:", {
      bridgeWindowHref: String(window.location?.href || ""),
      isTopWindow: window === window.top,
      isParentWindow: window === window.parent,
    });

    const normalizeCharWorldbooks = (value) => ({
      primary: value?.primary || "",
      additional: Array.isArray(value?.additional) ? value.additional.filter(Boolean) : [],
    });

    const hasWorkshopWorldbookPrefix = (entryName) => String(entryName || "").trim().startsWith("🧩mod ");

    const getWorldbookEntrySourceMeta = (entry) => {
      const meta = entry?.extra?.creativeWorkshop || null;
      if (meta) return meta;
      if (hasWorkshopWorldbookPrefix(entry?.name)) {
        return {
          sourceId: "",
          sourceType: "prefix",
          sourceTitle: String(entry?.name || "").replace("🧩mod ", "").trim(),
          sourceUpdatedAt: "",
          installedAt: "",
          slot: "prefix_only",
          fallback: true,
        };
      }
      return null;
    };

    const matchesCreativeWorkshopEntry = (entry, sourceMeta) => {
      const meta = getWorldbookEntrySourceMeta(entry);
      if (!meta || !sourceMeta?.sourceId) return false;
      return String(meta.sourceId) === String(sourceMeta.sourceId)
        && (!sourceMeta.sourceType || String(meta.sourceType || "") === String(sourceMeta.sourceType));
    };

    const createModBoundaryEntry = (name, order) => ({
      name,
      enabled: true,
      strategy: {
        type: "constant",
        keys: [],
        keys_secondary: { logic: "and_any", keys: [] },
        scan_depth: "same_as_global",
      },
      position: {
        type: "after_character_definition",
        role: "system",
        depth: 0,
        order,
      },
      content: "",
      probability: 100,
      recursion: {
        prevent_incoming: false,
        prevent_outgoing: false,
        delay_until: null,
      },
      effect: {
        sticky: null,
        cooldown: null,
        delay: null,
      },
      extra: {
        creativeWorkshop: {
          sourceId: name,
          sourceType: "anchor",
          sourceTitle: name,
          installedAt: new Date().toISOString(),
          slot: "anchor",
        },
      },
    });

    const normalizeBoundaryEntryName = (name) => String(name || "").trim();

    const normalizeWorkshopPositionType = (value) => {
      const normalized = String(value || "").trim();
      if (normalized === "before_character_definition" || normalized === "after_character_definition" || normalized === "at_depth") {
        return normalized;
      }
      return "after_character_definition";
    };

    const normalizeWorkshopDepthValue = (value) => {
      const nextValue = Number(value);
      if (!Number.isFinite(nextValue)) {
        return 0;
      }
      return Math.max(0, Math.floor(nextValue));
    };

    const normalizeWorkshopManagedPosition = (position = {}, fallbackOrder = config.startOrder + 1) => {
      const nextOrder = Number(position?.order);
      return {
        ...(position || {}),
        type: normalizeWorkshopPositionType(position?.type),
        role: position?.role || "system",
        depth: normalizeWorkshopDepthValue(position?.depth),
        order: Number.isFinite(nextOrder) ? nextOrder : fallbackOrder,
      };
    };

    const ensureWorkshopBoundaryEntries = (worldbook) => {
      const nextWorldbook = [...worldbook];
      const startMatches = nextWorldbook.filter((entry) => normalizeBoundaryEntryName(entry?.name) === config.startName);
      const endMatches = nextWorldbook.filter((entry) => normalizeBoundaryEntryName(entry?.name) === config.endName);
      let startEntry = startMatches[0] || null;
      let endEntry = endMatches[0] || null;
      const dedupedWorldbook = nextWorldbook.filter((entry) => {
        const normalizedName = normalizeBoundaryEntryName(entry?.name);
        if (normalizedName === config.startName) return entry === startEntry;
        if (normalizedName === config.endName) return entry === endEntry;
        return true;
      });
      if (!startEntry) {
        startEntry = createModBoundaryEntry(config.startName, config.startOrder);
        dedupedWorldbook.push(startEntry);
      }
      if (!endEntry) {
        endEntry = createModBoundaryEntry(config.endName, config.endOrder);
        dedupedWorldbook.push(endEntry);
      }
      startEntry.position = { ...(startEntry.position || {}), type: "after_character_definition", role: "system", depth: 0, order: config.startOrder };
      endEntry.position = { ...(endEntry.position || {}), type: "after_character_definition", role: "system", depth: 0, order: config.endOrder };
      startEntry.enabled = true;
      endEntry.enabled = true;
      startEntry.name = config.startName;
      endEntry.name = config.endName;
      return dedupedWorldbook;
    };

    const reorderWorkshopManagedEntries = (worldbook) => {
      const nextWorldbook = ensureWorkshopBoundaryEntries(worldbook);
      const managedEntries = nextWorldbook
        .filter((entry) => {
          const normalizedName = normalizeBoundaryEntryName(entry?.name);
          if (normalizedName === config.startName || normalizedName === config.endName) return false;
          const meta = getWorldbookEntrySourceMeta(entry);
          return !!meta && meta.sourceType !== "anchor";
        })
        .sort((a, b) => {
          const aOrder = Number(a?.position?.order ?? 0);
          const bOrder = Number(b?.position?.order ?? 0);
          if (aOrder !== bOrder) return aOrder - bOrder;
          return String(a?.name || "").localeCompare(String(b?.name || ""));
        });
      managedEntries.forEach((entry, index) => {
        entry.position = normalizeWorkshopManagedPosition(entry.position || {}, config.startOrder + 1 + index);
      });
      return nextWorldbook;
    };

    const summarizeContext = (context) => ({
      bridgeSource: context?.bridgeSource || "",
      targetHref: context?.targetHref || "",
      primary: context?.charWorldbooks?.primary || "",
      additional: Array.isArray(context?.charWorldbooks?.additional) ? context.charWorldbooks.additional : [],
      chatWorldbook: context?.chatWorldbook || "",
      globalWorldbooks: Array.isArray(context?.globalWorldbooks) ? context.globalWorldbooks : [],
      worldbookNames: Array.isArray(context?.worldbookNames) ? context.worldbookNames : [],
      canCreateWorldbook: !!context?.canCreateWorldbook,
    });

    const getWorkshopWorldbookContext = () => {
      const api = getWorldbookApi();
      const context = {
        worldbookNames: api.getWorldbookNames ? (api.getWorldbookNames() || []) : [],
        globalWorldbooks: api.getGlobalWorldbookNames ? (api.getGlobalWorldbookNames() || []) : [],
        charWorldbooks: api.getCharWorldbookNames
          ? normalizeCharWorldbooks(api.getCharWorldbookNames("current") || { primary: "", additional: [] })
          : { primary: "", additional: [] },
        chatWorldbook: api.getChatWorldbookName ? (api.getChatWorldbookName("current") || "") : "",
        canCreateWorldbook: !!api.createWorldbook,
        bridgeSource: api.helper ? "TavernHelper" : "global",
        targetHref: api.targetWindow?.location?.href || "",
      };
      
      console.log(config.logPrefix, "世界书桥接初始化成功");
      return context;
    };

    const handleWorkshopBridgeAction = async (action, payload = {}) => {
      const api = getWorldbookApi();
      switch (action) {
        case "handshake":
          return {
            ok: true,
            label: "云端工坊面板桥接",
            bridgeSource: api.helper ? "TavernHelper" : "global",
            capabilities: {
              getWorldbookNames: !!api.getWorldbookNames,
              getCharWorldbookNames: !!api.getCharWorldbookNames,
              getWorldbook: !!api.getWorldbook,
              createWorldbook: !!api.createWorldbook,
              createWorldbookEntries: !!api.createWorldbookEntries,
              updateWorldbookWith: !!api.updateWorldbookWith,
              deleteWorldbookEntries: !!api.deleteWorldbookEntries,
            },
            targetHref: api.targetWindow?.location?.href || "",
          };
        case "getContext": {
          const context = getWorkshopWorldbookContext();
          return { context };
        }
        case "getEntries":
          if (!api.getWorldbook) throw new Error("getWorldbook 不可用");
          console.log(config.logPrefix, "读取世界书条目:", payload.worldbookName);
          return { entries: await api.getWorldbook(payload.worldbookName) };
        case "createWorldbook":
          if (!api.createWorldbook) throw new Error("createWorldbook 不可用");
          console.log(config.logPrefix, "创建世界书:", payload.worldbookName);
          return await api.createWorldbook(payload.worldbookName, []);
        case "createEntries":
          if (!api.createWorldbookEntries) throw new Error("createWorldbookEntries 不可用");
          console.log(config.logPrefix, "创建世界书条目:", payload.worldbookName, Array.isArray(payload.entries) ? payload.entries.length : 0);
          return await api.createWorldbookEntries(payload.worldbookName, payload.entries || [], { render: "immediate" });
        case "updateEntry":
          if (!api.updateWorldbookWith) throw new Error("updateWorldbookWith 不可用");
          console.log(config.logPrefix, "更新世界书条目:", payload.worldbookName, payload.uid);
          return await api.updateWorldbookWith(payload.worldbookName, (worldbook) => worldbook.map((entry) => (
            Number(entry.uid) === Number(payload.uid) ? { ...entry, ...(payload.nextEntry || {}) } : entry
          )), { render: "immediate" });
        case "deleteEntries": {
          if (!api.deleteWorldbookEntries) throw new Error("deleteWorldbookEntries 不可用");
          const uidSet = new Set((payload.uids || []).map((uid) => Number(uid)));
          console.log(config.logPrefix, "删除世界书条目:", payload.worldbookName, Array.from(uidSet));
          return await api.deleteWorldbookEntries(payload.worldbookName, (entry) => uidSet.has(Number(entry.uid)), { render: "immediate" });
        }
        case "upsertWorkshopEntries":
          if (!api.updateWorldbookWith) throw new Error("updateWorldbookWith 不可用");
          console.log(config.logPrefix, "写入工坊条目:", payload.worldbookName, payload.sourceMeta || {});
          return await api.updateWorldbookWith(payload.worldbookName, (worldbook) => {
            const withBoundaries = ensureWorkshopBoundaryEntries(worldbook);
            const remaining = withBoundaries.filter((entry) => !matchesCreativeWorkshopEntry(entry, payload.sourceMeta || {}));
            return reorderWorkshopManagedEntries([...(remaining || []), ...((payload.entries || []).map((entry) => ({
              ...entry,
              position: normalizeWorkshopManagedPosition(entry.position || {}),
            })))]);
          }, { render: "immediate" });
        default:
          throw new Error(`未知桥接动作: ${action}`);
      }
    };

    window.addEventListener("message", async (event) => {
      try {
        const data = event.data;
        if (!data || data.channel !== config.channel || data.kind !== "request") return;
        if (event.origin !== config.targetOrigin) return;
        console.log(config.logPrefix, "桥接收到消息:", {
          action: data.action,
          origin: event.origin,
        });

        const response = {
          channel: config.channel,
          kind: "response",
          id: data.id,
        };

        try {
          const payload = await handleWorkshopBridgeAction(data.action, data.payload || {});
          event.source?.postMessage({ ...response, ok: true, payload }, event.origin);
        } catch (error) {
          console.error(config.logPrefix, "世界书桥接请求失败:", error);
          event.source?.postMessage({ ...response, ok: false, error: error?.message || String(error) }, event.origin);
        }
      } catch (error) {
        console.error(config.logPrefix, "创意工坊桥接消息处理失败:", error);
      }
    });
  };

  const normalizeCharWorldbooks = (value) => ({
    primary: value?.primary || "",
    additional: Array.isArray(value?.additional) ? value.additional.filter(Boolean) : [],
  });

  const hasWorkshopWorldbookPrefix = (entryName) => String(entryName || "").trim().startsWith("🧩mod ");

  const getWorldbookEntrySourceMeta = (entry) => {
    const meta = entry?.extra?.creativeWorkshop || null;
    if (meta) return meta;
    if (hasWorkshopWorldbookPrefix(entry?.name)) {
      return {
        sourceId: "",
        sourceType: "prefix",
        sourceTitle: String(entry?.name || "").replace("🧩mod ", "").trim(),
        sourceUpdatedAt: "",
        installedAt: "",
        slot: "prefix_only",
        fallback: true,
      };
    }
    return null;
  };

  const matchesCreativeWorkshopEntry = (entry, sourceMeta) => {
    const meta = getWorldbookEntrySourceMeta(entry);
    if (!meta || !sourceMeta?.sourceId) return false;
    return String(meta.sourceId) === String(sourceMeta.sourceId)
      && (!sourceMeta.sourceType || String(meta.sourceType || "") === String(sourceMeta.sourceType));
  };

  const createModBoundaryEntry = (name, order) => ({
    name,
    enabled: true,
    strategy: {
      type: "constant",
      keys: [],
      keys_secondary: { logic: "and_any", keys: [] },
      scan_depth: "same_as_global",
    },
    position: {
      type: "after_character_definition",
      role: "system",
      depth: 0,
      order,
    },
    content: "",
    probability: 100,
    recursion: {
      prevent_incoming: false,
      prevent_outgoing: false,
      delay_until: null,
    },
    effect: {
      sticky: null,
      cooldown: null,
      delay: null,
    },
    extra: {
      creativeWorkshop: {
        sourceId: name,
        sourceType: "anchor",
        sourceTitle: name,
        installedAt: new Date().toISOString(),
        slot: "anchor",
      },
    },
  });

  const normalizeBoundaryEntryName = (name) => String(name || "").trim();

  const normalizeWorkshopPositionType = (value) => {
    const normalized = String(value || "").trim();
    if (normalized === "before_character_definition" || normalized === "after_character_definition" || normalized === "at_depth") {
      return normalized;
    }
    return "after_character_definition";
  };

  const normalizeWorkshopDepthValue = (value) => {
    const nextValue = Number(value);
    if (!Number.isFinite(nextValue)) {
      return 0;
    }
    return Math.max(0, Math.floor(nextValue));
  };

  const normalizeWorkshopManagedPosition = (position = {}, fallbackOrder = WORKSHOP_MOD_START_ORDER + 1) => {
    const nextOrder = Number(position?.order);
    return {
      ...(position || {}),
      type: normalizeWorkshopPositionType(position?.type),
      role: position?.role || "system",
      depth: normalizeWorkshopDepthValue(position?.depth),
      order: Number.isFinite(nextOrder) ? nextOrder : fallbackOrder,
    };
  };

  const ensureWorkshopBoundaryEntries = (worldbook) => {
    const nextWorldbook = [...worldbook];
    const startMatches = nextWorldbook.filter((entry) => normalizeBoundaryEntryName(entry?.name) === WORKSHOP_MOD_START_NAME);
    const endMatches = nextWorldbook.filter((entry) => normalizeBoundaryEntryName(entry?.name) === WORKSHOP_MOD_END_NAME);
    let startEntry = startMatches[0] || null;
    let endEntry = endMatches[0] || null;
    const dedupedWorldbook = nextWorldbook.filter((entry) => {
      const normalizedName = normalizeBoundaryEntryName(entry?.name);
      if (normalizedName === WORKSHOP_MOD_START_NAME) return entry === startEntry;
      if (normalizedName === WORKSHOP_MOD_END_NAME) return entry === endEntry;
      return true;
    });
    if (!startEntry) {
      startEntry = createModBoundaryEntry(WORKSHOP_MOD_START_NAME, WORKSHOP_MOD_START_ORDER);
      dedupedWorldbook.push(startEntry);
    }
    if (!endEntry) {
      endEntry = createModBoundaryEntry(WORKSHOP_MOD_END_NAME, WORKSHOP_MOD_END_ORDER);
      dedupedWorldbook.push(endEntry);
    }
    startEntry.position = { ...(startEntry.position || {}), type: "after_character_definition", role: "system", depth: 0, order: WORKSHOP_MOD_START_ORDER };
    endEntry.position = { ...(endEntry.position || {}), type: "after_character_definition", role: "system", depth: 0, order: WORKSHOP_MOD_END_ORDER };
    startEntry.enabled = true;
    endEntry.enabled = true;
    startEntry.name = WORKSHOP_MOD_START_NAME;
    endEntry.name = WORKSHOP_MOD_END_NAME;
    return dedupedWorldbook;
  };

  const reorderWorkshopManagedEntries = (worldbook) => {
    const nextWorldbook = ensureWorkshopBoundaryEntries(worldbook);
    const managedEntries = nextWorldbook
      .filter((entry) => {
        const normalizedName = normalizeBoundaryEntryName(entry?.name);
        if (normalizedName === WORKSHOP_MOD_START_NAME || normalizedName === WORKSHOP_MOD_END_NAME) {
          return false;
        }
        const meta = getWorldbookEntrySourceMeta(entry);
        return !!meta && meta.sourceType !== "anchor";
      })
      .sort((a, b) => {
        const aOrder = Number(a?.position?.order ?? 0);
        const bOrder = Number(b?.position?.order ?? 0);
        if (aOrder !== bOrder) return aOrder - bOrder;
        return String(a?.name || "").localeCompare(String(b?.name || ""));
      });
    managedEntries.forEach((entry, index) => {
      entry.position = normalizeWorkshopManagedPosition(entry.position || {}, WORKSHOP_MOD_START_ORDER + 1 + index);
    });
    return nextWorldbook;
  };

  async function waitForDependencies() {
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_WAIT_TIME) {
      const hasWaitGlobal = typeof waitGlobalInitialized === "function";
      const hasEventOn = typeof eventOn === "function";
      const hasGetButtonEvent = typeof getButtonEvent === "function";
      const hasToastr = typeof toastr !== "undefined";
      if (hasWaitGlobal && hasEventOn && hasGetButtonEvent && hasToastr) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
    }
    return false;
  }

  const ensureStyles = () => {
    const { $, document: doc } = getUiHost();
    if (!$ || doc.getElementById(STYLE_ID)) return;
    $(doc.head).append(`
      <style id="${STYLE_ID}">
        #${PANEL_ID} {
          position: fixed;
          inset: 0;
          z-index: 999999;
          display: none;
          align-items: center;
          justify-content: center;
          background: rgba(8, 10, 18, 0.72);
          backdrop-filter: blur(8px);
        }
        #${PANEL_ID}.visible {
          display: flex;
        }
        #${PANEL_ID} .cfw-shell {
          width: min(1440px, 92vw);
          height: min(900px, 88vh);
          display: flex;
          flex-direction: column;
          border-radius: 18px;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: linear-gradient(180deg, #111827 0%, #0f172a 100%);
          box-shadow: 0 22px 80px rgba(0, 0, 0, 0.45);
        }
        #${PANEL_ID} .cfw-header {
          height: 56px;
          padding: 0 16px 0 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: linear-gradient(90deg, rgba(59, 130, 246, 0.22), rgba(14, 165, 233, 0.08));
          border-bottom: 1px solid rgba(255, 255, 255, 0.08);
          color: #e5eefb;
        }
        #${PANEL_ID} .cfw-title {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 15px;
          font-weight: 700;
          letter-spacing: 0.04em;
        }
        #${PANEL_ID} .cfw-title-dot {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          background: #38bdf8;
          box-shadow: 0 0 12px rgba(56, 189, 248, 0.75);
        }
        #${PANEL_ID} .cfw-actions {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        #${PANEL_ID} .cfw-btn {
          appearance: none;
          border: 0;
          border-radius: 10px;
          padding: 8px 12px;
          background: rgba(255, 255, 255, 0.08);
          color: #e2e8f0;
          font-size: 13px;
          cursor: pointer;
          transition: background 0.18s ease, transform 0.18s ease;
        }
        #${PANEL_ID} .cfw-btn:hover {
          background: rgba(255, 255, 255, 0.16);
          transform: translateY(-1px);
        }
        #${PANEL_ID} .cfw-body {
          flex: 1;
          background: #020617;
        }
        #${PANEL_ID} .cfw-iframe {
          width: 100%;
          height: 100%;
          border: 0;
          background: #fff;
        }
      </style>
    `);
  };

  const removePanel = () => {
    const { $, window: win, document: doc } = getUiHost();
    if (!$) return;
    $(doc.getElementById(PANEL_ID)).remove();
    $(doc.getElementById(STYLE_ID)).remove();
    getPageHostCandidates().forEach((host) => {
      try {
        const targetDoc = host?.document;
        const bridgeNode = targetDoc?.getElementById?.(BRIDGE_SCRIPT_ID);
        if (bridgeNode) {
          bridgeNode.remove();
        }
      } catch (e) {}
    });
    try {
      delete win[`${SCRIPT_ID}_toggle`];
      delete win[`${SCRIPT_ID}_open`];
      delete win[`${SCRIPT_ID}_close`];
      delete win[`${SCRIPT_ID}_cleanup`];
      delete win[_hostBootKey];
    } catch (e) {}
  };

  const ensureIframeLoaded = ($panel) => {
    const $iframe = $panel.find(".cfw-iframe");
    if (!$iframe.length) return;
    const iframe = $iframe.get(0);
    const currentSrc = String($iframe.attr("src") || "");
    if (iframe && !currentSrc) {
      $iframe.attr("src", TARGET_URL);
    }
  };

  const getPanelIframeWindow = () => {
    const { document: doc } = getUiHost();
    const iframe = doc.querySelector(`#${PANEL_ID} .cfw-iframe`);
    return iframe?.contentWindow || null;
  };

  const ensureWorldbookBridge = () => {
    // 优先注入到酒馆主窗口（parent），而不是iframe内部
    let tavernWindow = window;
    let tavernDoc = document;
    
    // 尝试获取父窗口（酒馆主页面）
    try {
      if (window.parent && window.parent !== window) {
        // 检查父窗口是否有酒馆API
        if (window.parent.TavernHelper || 
            typeof window.parent.getWorldbook === "function" ||
            typeof window.parent.getWorldbookNames === "function") {
          tavernWindow = window.parent;
          tavernDoc = window.parent.document;
          log.info("检测到父窗口有酒馆API，将桥接脚本注入到父窗口");
        }
      }
    } catch (e) {
      log.warn("无法访问父窗口，使用当前窗口:", e);
    }
    
    // 强制删除旧的桥接脚本（确保使用最新代码）
    const oldScript = tavernDoc.getElementById(BRIDGE_SCRIPT_ID);
    if (oldScript) {
      oldScript.remove();
      log.info("已删除旧的桥接脚本，将重新注入");
    }
    
    const candidateDebug = getPageHostCandidates().map((host) => ({
      score: scorePageHost(host),
      ...summarizeHost(host),
    })).sort((a, b) => b.score - a.score);
    log.info("页面宿主候选:", candidateDebug);
    const bridgeConfig = {
      bootKey: `${SCRIPT_ID}__page_bridge_booted`,
      targetOrigin: TARGET_ORIGIN,
      channel: WORLDBOOK_BRIDGE_CHANNEL,
      startName: WORKSHOP_MOD_START_NAME,
      endName: WORKSHOP_MOD_END_NAME,
      startOrder: WORKSHOP_MOD_START_ORDER,
      endOrder: WORKSHOP_MOD_END_ORDER,
      logPrefix: log.prefix,
    };
    const script = tavernDoc.createElement("script");
    script.id = BRIDGE_SCRIPT_ID;
    script.textContent = `(${pageBridgeBootstrap.toString()})(${JSON.stringify(bridgeConfig)});`;
    (tavernDoc.head || tavernDoc.documentElement || tavernDoc.body).appendChild(script);
    log.info("世界书桥接已注入到酒馆主窗口", tavernWindow.location?.href || "", summarizeHost({ window: tavernWindow }));
  };

  const ensurePanel = () => {
    const { $, window: win, document: doc } = getUiHost();
    if (!$) return null;
    ensureStyles();
    let $panel = $(doc.getElementById(PANEL_ID));
    if ($panel.length) return $panel;

    $(doc.body).append(`
      <div id="${PANEL_ID}">
        <div class="cfw-shell">
          <div class="cfw-header">
            <div class="cfw-title">
              <span class="cfw-title-dot"></span>
              <span>云端工坊</span>
            </div>
            <div class="cfw-actions">
              <button type="button" class="cfw-btn" data-action="refresh">刷新</button>
              <button type="button" class="cfw-btn" data-action="newtab">新窗口打开</button>
              <button type="button" class="cfw-btn" data-action="close">关闭</button>
            </div>
          </div>
          <div class="cfw-body">
            <iframe class="cfw-iframe" src="" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="clipboard-read; clipboard-write"></iframe>
          </div>
        </div>
      </div>
    `);

    $panel = $(doc.getElementById(PANEL_ID));
    $panel.on("click", function (e) {
      if (e.target === this) {
        $panel.removeClass("visible");
      }
    });
    $panel.on("load", ".cfw-iframe", function () {
      log.info("工坊 iframe 已加载", {
        src: String($(this).attr("src") || ""),
      });
    });
    $panel.on("click", ".cfw-btn", function () {
      const action = String($(this).attr("data-action") || "");
      const $iframe = $panel.find(".cfw-iframe");
      if (action === "close") {
        $panel.removeClass("visible");
        return;
      }
      if (action === "refresh") {
        $iframe.attr("src", TARGET_URL);
        return;
      }
      if (action === "newtab") {
        win.open(TARGET_URL, "_blank", "noopener,noreferrer");
      }
    });

    win[`${SCRIPT_ID}_toggle`] = () => {
      const $targetPanel = ensurePanel();
      if (!$targetPanel) return;
      ensureIframeLoaded($targetPanel);
      $targetPanel.toggleClass("visible");
    };
    win[`${SCRIPT_ID}_open`] = () => {
      const $targetPanel = ensurePanel();
      if (!$targetPanel) return;
      ensureIframeLoaded($targetPanel);
      $targetPanel.addClass("visible");
    };
    win[`${SCRIPT_ID}_close`] = () => {
      ensurePanel().removeClass("visible");
    };
    win[`${SCRIPT_ID}_cleanup`] = removePanel;
    return $panel;
  };

  // Discord 登录处理：监听来自 iframe 的登录请求
  const setupDiscordLoginHandler = () => {
    const { window: win } = getUiHost();
    
    // 存储打开的登录窗口引用
    let discordLoginWindow = null;
    
    // 监听来自弹出窗口的登录完成消息
    win.addEventListener("message", (event) => {
      try {
        const data = event.data;
        
        console.log('[云端工坊面板] 收到消息:', {
          channel: data?.channel,
          action: data?.action,
          origin: event.origin
        });
        
        // 处理来自登录弹出窗口的成功消息
        if (data?.channel === "creative-workshop:auth" && data?.action === "discordLoginSuccess") {
          log.info("收到登录弹出窗口的成功通知");
          console.log('[云端工坊面板] Discord 登录成功，hash:', data.hash);
          
          // 通知 iframe 登录完成
          const iframeWindow = getPanelIframeWindow();
          if (iframeWindow) {
            console.log('[云端工坊面板] 准备通知 iframe');
            try {
              // 使用通配符 origin 确保消息能够送达
              iframeWindow.postMessage({
                channel: "creative-workshop:auth",
                action: "discordLoginComplete",
                hash: data.hash,
              }, '*');
              log.info("已通知 iframe Discord 登录完成");
              console.log('[云端工坊面板] 已通知 iframe (使用通配符 origin)');
            } catch (e) {
              console.error('[云端工坊面板] 发送消息到 iframe 失败:', e);
            }
          } else {
            console.error('[云端工坊面板] 无法获取 iframe window');
          }
          
          // 延迟一点关闭登录窗口，让弹出窗口有时间自己关闭
          setTimeout(() => {
            if (discordLoginWindow && !discordLoginWindow.closed) {
              console.log('[云端工坊面板] 关闭登录窗口');
              discordLoginWindow.close();
            }
          }, 200);
          
          toastr?.success?.("Discord 登录成功", "登录完成");
          return;
        }
        
        // 处理来自登录弹出窗口的错误消息
        if (data?.channel === "creative-workshop:auth" && data?.action === "discordLoginError") {
          log.error("Discord 登录失败:", data.error);
          console.error('[云端工坊面板] Discord 登录失败:', data.error, data.errorDescription);
          toastr?.error?.(data.errorDescription || data.error || "登录失败", "Discord 登录");
          
          // 关闭登录窗口（如果还没关闭）
          if (discordLoginWindow && !discordLoginWindow.closed) {
            discordLoginWindow.close();
          }
          return;
        }
        
        // 处理来自 iframe 的登录请求
        if (data?.channel === "creative-workshop:auth" && data?.action === "openDiscordLogin") {
          log.info("收到 Discord 登录请求，打开新窗口");
          console.log('[云端工坊面板] 打开 Discord 登录窗口，URL:', data.url);
          
          // 关闭之前的登录窗口（如果存在）
          if (discordLoginWindow && !discordLoginWindow.closed) {
            discordLoginWindow.close();
          }
          
          // 在新窗口中打开 Discord 授权页面
          discordLoginWindow = win.open(
            data.url,
            "discord_login",
            "width=600,height=800,scrollbars=yes,resizable=yes"
          );
          
          if (!discordLoginWindow) {
            log.error("无法打开 Discord 登录窗口，可能被浏览器拦截");
            console.error('[云端工坊面板] 无法打开登录窗口');
            toastr?.warning?.("请允许弹出窗口以完成 Discord 登录", "登录提示");
            return;
          }
          
          console.log('[云端工坊面板] 登录窗口已打开');
          toastr?.info?.("请在弹出窗口中完成 Discord 登录", "登录中");
        }
      } catch (error) {
        log.error("Discord 登录处理失败:", error);
      }
    });
    
    log.info("Discord 登录处理器已启动");
  };

  const togglePanelFromEvent = (sourceName) => {
    const now = Date.now();
    if (now - _lastToggleAt < 150) return;
    _lastToggleAt = now;
    log.info(`收到按钮事件: ${sourceName}`);
    const $panel = ensurePanel();
    if (!$panel) {
      throw new Error("面板挂载失败");
    }
    ensureIframeLoaded($panel);
    $panel.toggleClass("visible");
  };

  try {
    removePanel();

    const depsReady = await waitForDependencies();
    if (!depsReady) {
      log.error("初始化失败：依赖未加载完成");
      return;
    }

    await waitGlobalInitialized("Mvu");

    ensurePanel();
    ensureWorldbookBridge();
    setupDiscordLoginHandler(); // 启动 Discord 登录处理器
    
    eventOn(getButtonEvent(BUTTON_EVENT_NAME), async () => {
      try {
        togglePanelFromEvent(BUTTON_EVENT_NAME);
      } catch (e) {
        log.error("切换面板失败:", e);
        toastr?.error?.("创意工坊失败");
      }
    });

    log.info(`已绑定按钮事件: ${BUTTON_EVENT_NAME}`);
    log.info("世界书桥接已启用");
    log.info("Discord 登录桥接已启用");
    toastr?.success?.(`云端工坊面板已就绪`, "脚本加载完成");
  } catch (e) {
    log.error("初始化异常:", e);
  }
})();
