figma.showUI(__html__, { width: 1120, height: 780, themeColors: true });
figma.skipInvisibleInstanceChildren = true;

const SETTINGS_KEY = "figma-site-exporter-v7-settings";
const MIXED = typeof figma !== "undefined" ? figma.mixed : Symbol("mixed");

function isMixed(value) {
  return value === MIXED || typeof value === "symbol";
}

function finite(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function safeValue(value) {
  if (isMixed(value) || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.map(safeValue);
  if (typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value)) {
      const v = safeValue(value[key]);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return null;
}

function rgba(color, opacity = 1) {
  if (!color) return null;
  return {
    r: finite(color.r),
    g: finite(color.g),
    b: finite(color.b),
    a: finite(color.a, 1) * finite(opacity, 1)
  };
}

function serializePaint(paint) {
  if (!paint || paint.visible === false) return null;
  const base = { type: paint.type, opacity: finite(paint.opacity, 1), blendMode: paint.blendMode || "NORMAL" };
  if (paint.type === "SOLID") return { ...base, color: rgba(paint.color, paint.opacity) };
  if (paint.type && paint.type.startsWith("GRADIENT_")) {
    return {
      ...base,
      gradientStops: (paint.gradientStops || []).map((stop) => ({ position: stop.position, color: rgba(stop.color) })),
      gradientHandlePositions: safeValue(paint.gradientHandlePositions || null),
      gradientTransform: safeValue(paint.gradientTransform || null)
    };
  }
  if (paint.type === "IMAGE") {
    return {
      ...base,
      imageHash: paint.imageHash || null,
      scaleMode: paint.scaleMode || "FILL",
      imageTransform: safeValue(paint.imageTransform || null),
      scalingFactor: finite(paint.scalingFactor, 0.5),
      rotation: finite(paint.rotation, 0),
      filters: safeValue(paint.filters || null)
    };
  }
  return base;
}

function serializeEffects(effects) {
  if (!Array.isArray(effects)) return [];
  return effects.filter((effect) => effect && effect.visible !== false).map((effect) => ({
    type: effect.type,
    color: effect.color ? rgba(effect.color) : null,
    offset: safeValue(effect.offset || null),
    radius: finite(effect.radius),
    spread: finite(effect.spread),
    blendMode: effect.blendMode || "NORMAL",
    showShadowBehindNode: effect.showShadowBehindNode !== false
  }));
}

function styleId(node, key) {
  try {
    const value = node[key];
    return typeof value === "string" ? value : null;
  } catch (_) {
    return null;
  }
}

function serializeText(node) {
  if (node.type !== "TEXT") return null;
  const fontName = isMixed(node.fontName) ? null : safeValue(node.fontName);
  const fontSize = isMixed(node.fontSize) ? null : finite(node.fontSize, null);
  const fontWeight = isMixed(node.fontWeight) ? null : finite(node.fontWeight, null);
  const lineHeight = isMixed(node.lineHeight) ? null : safeValue(node.lineHeight);
  const letterSpacing = isMixed(node.letterSpacing) ? null : safeValue(node.letterSpacing);
  return {
    characters: node.characters || "",
    fontName,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    textAlignHorizontal: node.textAlignHorizontal || "LEFT",
    textAlignVertical: node.textAlignVertical || "TOP",
    textAutoResize: node.textAutoResize || "NONE",
    textCase: isMixed(node.textCase) ? null : node.textCase,
    textDecoration: isMixed(node.textDecoration) ? null : node.textDecoration,
    paragraphSpacing: isMixed(node.paragraphSpacing) ? null : finite(node.paragraphSpacing),
    paragraphIndent: isMixed(node.paragraphIndent) ? null : finite(node.paragraphIndent),
    listSpacing: isMixed(node.listSpacing) ? null : finite(node.listSpacing),
    hyperlink: safeValue(node.hyperlink || null)
  };
}

function readLayout(node) {
  let source = "none";
  let layout = null;
  try {
    if ("layoutMode" in node && node.layoutMode && node.layoutMode !== "NONE") {
      source = "auto-layout";
      layout = node;
    } else if ("inferredAutoLayout" in node && node.inferredAutoLayout) {
      source = "inferred";
      layout = node.inferredAutoLayout;
    }
  } catch (_) {}
  if (!layout) return { source, mode: "NONE" };
  return {
    source,
    mode: layout.layoutMode || "NONE",
    wrap: layout.layoutWrap || "NO_WRAP",
    gap: finite(layout.itemSpacing),
    rowGap: finite(layout.counterAxisSpacing),
    paddingTop: finite(layout.paddingTop),
    paddingRight: finite(layout.paddingRight),
    paddingBottom: finite(layout.paddingBottom),
    paddingLeft: finite(layout.paddingLeft),
    primaryAlign: layout.primaryAxisAlignItems || "MIN",
    counterAlign: layout.counterAxisAlignItems || "MIN",
    counterAlignContent: layout.counterAxisAlignContent || "AUTO",
    primarySizing: layout.primaryAxisSizingMode || null,
    counterSizing: layout.counterAxisSizingMode || null,
    gridColumnCount: finite(layout.gridColumnCount, 0),
    gridRowCount: finite(layout.gridRowCount, 0),
    gridColumnGap: finite(layout.gridColumnGap, 0),
    gridRowGap: finite(layout.gridRowGap, 0),
    gridColumnSizes: safeValue(layout.gridColumnSizes || null),
    gridRowSizes: safeValue(layout.gridRowSizes || null),
    strokesIncludedInLayout: Boolean(layout.strokesIncludedInLayout)
  };
}

function componentInfo(node) {
  const info = { isComponent: false, isInstance: false, componentName: null, variantProperties: null };
  try {
    if (node.type === "COMPONENT" || node.type === "COMPONENT_SET") {
      info.isComponent = true;
      info.componentName = node.name;
    }
    if (node.type === "INSTANCE") {
      info.isInstance = true;
      info.componentName = node.mainComponent ? node.mainComponent.name : node.name;
      info.variantProperties = safeValue(node.variantProperties || null);
    }
  } catch (_) {}
  return info;
}

function semanticHint(node, parent, index, siblingCount) {
  const name = String(node.name || "").toLowerCase();
  const text = node.type === "TEXT" ? String(node.characters || "").trim().toLowerCase() : "";
  const words = `${name} ${text}`;
  if (/\b(header|navbar|topbar|app bar)\b/.test(words)) return "header";
  if (/\b(footer|bottom bar)\b/.test(words)) return "footer";
  if (/\b(nav|menu|navigation)\b/.test(words)) return "nav";
  if (/\b(hero|cover|intro|banner)\b/.test(words)) return "hero";
  if (/\b(pricing|plans|tariff)\b/.test(words)) return "pricing";
  if (/\b(testimonial|review|quote)\b/.test(words)) return "testimonial";
  if (/\b(feature|benefit|advantage)\b/.test(words)) return "features";
  if (/\b(contact|feedback)\b/.test(words)) return "contact";
  if (/\b(form|signup|sign up|login|log in)\b/.test(words)) return "form";
  if (/\b(input|search|email|password|field)\b/.test(words)) return "input";
  if (/\b(button|btn|cta|action)\b/.test(words)) return "button";
  if (/\b(card|tile|item)\b/.test(words)) return "card";
  if (/\b(logo|brand)\b/.test(words)) return "logo";
  if (/\b(icon|glyph)\b/.test(words)) return "icon";
  if (/\b(image|photo|picture|avatar|thumbnail)\b/.test(words)) return "image";
  if (node.type === "TEXT") {
    const size = !isMixed(node.fontSize) ? finite(node.fontSize) : 0;
    if (size >= 44) return "heading-1";
    if (size >= 30) return "heading-2";
    if (size >= 22) return "heading-3";
    if (node.hyperlink) return "link";
    return "text";
  }
  if (parent && index === 0 && parent === figma.currentPage.selection[0] && node.y < 160) return "header";
  if (parent && index === siblingCount - 1 && parent === figma.currentPage.selection[0]) return "footer-candidate";
  return "container";
}

function shouldExportVectorAsset(node) {
  try {
    if (node.visible === false) return false;
    const name = String(node.name || "").toLowerCase();
    const semantic = /logo|icon|glyph|mark|symbol|arrow|chevron/.test(name);
    const small = finite(node.width) <= 512 && finite(node.height) <= 512;
    return Boolean((node.isAsset || semantic) && small && node.type !== "TEXT");
  } catch (_) {
    return false;
  }
}

function collectImagePaints(paints, imageHashes) {
  for (const paint of paints || []) {
    if (paint && paint.type === "IMAGE" && paint.imageHash) imageHashes.add(paint.imageHash);
  }
}

async function serializeNode(node, parent = null, index = 0, siblingCount = 1, state) {
  if (!node || node.visible === false) return null;
  const fills = "fills" in node && Array.isArray(node.fills) ? node.fills.map(serializePaint).filter(Boolean) : [];
  const strokes = "strokes" in node && Array.isArray(node.strokes) ? node.strokes.map(serializePaint).filter(Boolean) : [];
  collectImagePaints(fills, state.imageHashes);
  let css = {};
  try {
    if (typeof node.getCSSAsync === "function") css = await node.getCSSAsync();
  } catch (_) {}

  const serialized = {
    id: node.id,
    name: node.name || node.type,
    type: node.type,
    semanticHint: semanticHint(node, parent, index, siblingCount),
    x: finite(node.x),
    y: finite(node.y),
    width: finite(node.width),
    height: finite(node.height),
    rotation: finite(node.rotation),
    opacity: "opacity" in node ? finite(node.opacity, 1) : 1,
    blendMode: "blendMode" in node ? node.blendMode : "NORMAL",
    visible: node.visible !== false,
    locked: Boolean(node.locked),
    isAsset: Boolean(node.isAsset),
    clipsContent: "clipsContent" in node ? Boolean(node.clipsContent) : false,
    fills,
    strokes,
    strokeWeight: "strokeWeight" in node && !isMixed(node.strokeWeight) ? finite(node.strokeWeight) : 0,
    strokeTopWeight: "strokeTopWeight" in node ? finite(node.strokeTopWeight) : null,
    strokeRightWeight: "strokeRightWeight" in node ? finite(node.strokeRightWeight) : null,
    strokeBottomWeight: "strokeBottomWeight" in node ? finite(node.strokeBottomWeight) : null,
    strokeLeftWeight: "strokeLeftWeight" in node ? finite(node.strokeLeftWeight) : null,
    strokeAlign: "strokeAlign" in node ? node.strokeAlign : null,
    dashPattern: "dashPattern" in node ? safeValue(node.dashPattern) : null,
    cornerRadius: "cornerRadius" in node && !isMixed(node.cornerRadius) ? finite(node.cornerRadius) : null,
    topLeftRadius: "topLeftRadius" in node ? finite(node.topLeftRadius) : null,
    topRightRadius: "topRightRadius" in node ? finite(node.topRightRadius) : null,
    bottomRightRadius: "bottomRightRadius" in node ? finite(node.bottomRightRadius) : null,
    bottomLeftRadius: "bottomLeftRadius" in node ? finite(node.bottomLeftRadius) : null,
    effects: "effects" in node ? serializeEffects(node.effects) : [],
    constraints: "constraints" in node ? safeValue(node.constraints) : null,
    layout: readLayout(node),
    layoutPositioning: "layoutPositioning" in node ? node.layoutPositioning : "AUTO",
    layoutAlign: "layoutAlign" in node ? node.layoutAlign : null,
    layoutGrow: "layoutGrow" in node ? finite(node.layoutGrow) : 0,
    layoutSizingHorizontal: "layoutSizingHorizontal" in node ? node.layoutSizingHorizontal : null,
    layoutSizingVertical: "layoutSizingVertical" in node ? node.layoutSizingVertical : null,
    minWidth: "minWidth" in node ? finite(node.minWidth, null) : null,
    maxWidth: "maxWidth" in node ? finite(node.maxWidth, null) : null,
    minHeight: "minHeight" in node ? finite(node.minHeight, null) : null,
    maxHeight: "maxHeight" in node ? finite(node.maxHeight, null) : null,
    text: serializeText(node),
    component: componentInfo(node),
    styleIds: {
      fill: styleId(node, "fillStyleId"),
      stroke: styleId(node, "strokeStyleId"),
      effect: styleId(node, "effectStyleId"),
      text: styleId(node, "textStyleId"),
      grid: styleId(node, "gridStyleId")
    },
    boundVariables: "boundVariables" in node ? safeValue(node.boundVariables) : null,
    css: safeValue(css),
    children: []
  };

  const vectorAsset = shouldExportVectorAsset(node);
  if (vectorAsset) {
    const assetKey = `vector:${node.id}`;
    serialized.vectorAssetKey = assetKey;
    state.vectorNodes.push({ key: assetKey, node, name: node.name || "asset" });
    return serialized;
  }

  if ("children" in node && Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i += 1) {
      const child = await serializeNode(node.children[i], node, i, node.children.length, state);
      if (child) serialized.children.push(child);
    }
  }
  return serialized;
}


function descendantText(node) {
  const parts = [];
  (function visit(item) {
    if (!item) return;
    if (item.type === "TEXT" && item.text && item.text.characters) parts.push(item.text.characters.trim());
    for (const child of item.children || []) visit(child);
  })(node);
  return parts.filter(Boolean).join(" ").trim();
}

function refineLocalSemantics(root) {
  const rootHeight = Math.max(root.height || 1, 1);
  const rootWidth = Math.max(root.width || 1, 1);
  function visit(node, parent, depth, index) {
    const children = node.children || [];
    const textChildren = children.filter((c) => c.type === "TEXT");
    const imageChildren = children.filter((c) => (c.fills || []).some((p) => p.type === "IMAGE") || c.vectorAssetKey);
    const name = String(node.name || "").toLowerCase();
    const label = descendantText(node).toLowerCase();
    const rounded = (node.cornerRadius || 0) >= 6 || ((node.topLeftRadius || 0) + (node.topRightRadius || 0)) >= 12;
    const compact = node.width > 28 && node.width < 520 && node.height > 22 && node.height < 120;
    const oneShortText = textChildren.length === 1 && (textChildren[0].text?.characters || "").trim().length <= 42;
    const horizontalCluster = children.length >= 3 && children.every((c) => c.height <= Math.max(...children.map((x) => x.height || 0), 1) * 1.6);

    if (node.semanticHint === "container") {
      if (oneShortText && rounded && compact) node.semanticHint = "button";
      else if (depth === 1 && node.y <= rootHeight * 0.08 && node.width >= rootWidth * 0.55) node.semanticHint = "header";
      else if ((/nav|menu/.test(name) || horizontalCluster) && textChildren.length >= 2 && node.height < 180) node.semanticHint = "nav";
      else if (imageChildren.length >= 1 && textChildren.length >= 1 && children.length >= 3 && node.width < rootWidth * 0.72) node.semanticHint = "card";
      else if (depth === 1 && node.height >= rootHeight * 0.08) node.semanticHint = "section";
      else if (/avatar|profile/.test(name) || (node.type === "ELLIPSE" && node.width >= 24 && node.width <= 240)) node.semanticHint = "image";
      else if (/submit|send|buy|sell|start|pricing|learn|view|contact/.test(label) && rounded && compact) node.semanticHint = "button";
    }
    if (node.type === "TEXT") {
      const text = String(node.text?.characters || "").trim();
      if (node.text?.hyperlink) node.semanticHint = "link";
      else if (/^(submit|send|buy|sell|start|learn more|view|contact)$/i.test(text) && parent && parent.semanticHint === "container") parent.semanticHint = "button";
    }
    children.forEach((child, childIndex) => visit(child, node, depth + 1, childIndex));
  }
  visit(root, null, 0, 0);
  return root;
}

function tokenName(value) {
  return String(value || "token").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "token";
}

async function resolveVariableValue(variable, variablesById, modeId, seen = new Set()) {
  if (!variable || seen.has(variable.id)) return null;
  seen.add(variable.id);
  const value = variable.valuesByMode ? variable.valuesByMode[modeId] : null;
  if (value && typeof value === "object" && value.type === "VARIABLE_ALIAS") {
    const target = variablesById.get(value.id) || await figma.variables.getVariableByIdAsync(value.id);
    if (!target) return null;
    const targetMode = Object.keys(target.valuesByMode || {})[0];
    return resolveVariableValue(target, variablesById, targetMode, seen);
  }
  return safeValue(value);
}

async function collectTokens() {
  const result = { variables: [], paintStyles: [], textStyles: [], effectStyles: [] };
  try {
    const variables = await figma.variables.getLocalVariablesAsync();
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const collectionById = new Map(collections.map((c) => [c.id, c]));
    const byId = new Map(variables.map((v) => [v.id, v]));
    for (const variable of variables) {
      const collection = collectionById.get(variable.variableCollectionId);
      const mode = collection && collection.modes && collection.modes[0] ? collection.modes[0] : null;
      const modeId = mode ? mode.modeId : Object.keys(variable.valuesByMode || {})[0];
      result.variables.push({
        id: variable.id,
        name: variable.name,
        cssName: `--${tokenName(variable.name)}`,
        type: variable.resolvedType,
        collection: collection ? collection.name : null,
        mode: mode ? mode.name : null,
        value: await resolveVariableValue(variable, byId, modeId)
      });
    }
  } catch (_) {}

  try {
    const styles = await figma.getLocalPaintStylesAsync();
    result.paintStyles = styles.map((style) => ({ id: style.id, name: style.name, paints: style.paints.map(serializePaint).filter(Boolean) }));
  } catch (_) {}
  try {
    const styles = await figma.getLocalTextStylesAsync();
    result.textStyles = styles.map((style) => ({
      id: style.id,
      name: style.name,
      fontName: safeValue(style.fontName),
      fontSize: finite(style.fontSize),
      fontWeight: finite(style.fontWeight),
      lineHeight: safeValue(style.lineHeight),
      letterSpacing: safeValue(style.letterSpacing),
      paragraphSpacing: finite(style.paragraphSpacing)
    }));
  } catch (_) {}
  try {
    const styles = await figma.getLocalEffectStylesAsync();
    result.effectStyles = styles.map((style) => ({ id: style.id, name: style.name, effects: serializeEffects(style.effects) }));
  } catch (_) {}
  return result;
}

async function exportAssets(state) {
  const assets = [];
  for (const hash of state.imageHashes) {
    try {
      const image = figma.getImageByHash(hash);
      if (!image) continue;
      const bytes = await image.getBytesAsync();
      const size = await image.getSizeAsync();
      assets.push({ key: `image:${hash}`, kind: "raster", name: `image-${hash.slice(0, 8)}`, width: size.width, height: size.height, bytes });
    } catch (_) {}
  }
  for (const item of state.vectorNodes) {
    try {
      const bytes = await item.node.exportAsync({ format: "SVG", svgOutlineText: false, svgIdAttribute: true, svgSimplifyStroke: true });
      assets.push({ key: item.key, kind: "svg", name: item.name, width: item.node.width, height: item.node.height, bytes });
    } catch (_) {
      try {
        const bytes = await item.node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 2 } });
        assets.push({ key: item.key, kind: "raster", name: item.name, width: item.node.width * 2, height: item.node.height * 2, bytes });
      } catch (_) {}
    }
  }
  return assets;
}

function compactTree(node, depth = 0) {
  if (!node || depth > 6) return null;
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    hint: node.semanticHint,
    width: Math.round(node.width),
    height: Math.round(node.height),
    text: node.text ? node.text.characters.slice(0, 160) : null,
    children: (node.children || []).slice(0, 20).map((child) => compactTree(child, depth + 1)).filter(Boolean)
  };
}

function parseAiText(data) {
  if (!data) return null;
  if (typeof data.output_text === "string") return data.output_text;
  if (Array.isArray(data.output)) {
    const texts = [];
    for (const item of data.output) {
      for (const content of item.content || []) {
        if (typeof content.text === "string") texts.push(content.text);
      }
    }
    if (texts.length) return texts.join("\n");
  }
  if (data.choices && data.choices[0] && data.choices[0].message) return data.choices[0].message.content;
  return null;
}

async function runAiSemanticAnalysis(tree, options) {
  if (!options || !options.aiEnabled || !options.aiApiKey || !options.aiEndpoint || !options.aiModel) return { map: {}, warning: null };
  const prompt = `You are a UI-to-HTML semantic analyzer. Analyze the compact Figma node tree below. Return ONLY valid JSON with this shape: {"nodes":{"NODE_ID":{"role":"header|nav|main|section|hero|footer|article|card|button|link|form|input|heading-1|heading-2|heading-3|text|image|logo|icon|container","component":"optional reusable component name","ariaLabel":"optional"}}}. Do not invent node IDs. Prefer semantic HTML and identify repeated cards/components. Tree: ${JSON.stringify(compactTree(tree))}`;
  try {
    const body = options.aiEndpoint.includes("/responses")
      ? { model: options.aiModel, input: prompt, store: false }
      : { model: options.aiModel, messages: [{ role: "user", content: prompt }], temperature: 0, response_format: { type: "json_object" } };
    const response = await fetch(options.aiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${options.aiApiKey}` },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const data = await response.json();
    const text = parseAiText(data);
    if (!text) throw new Error("AI returned no text");
    const clean = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(clean);
    return { map: parsed.nodes || {}, warning: null };
  } catch (error) {
    return { map: {}, warning: `AI analysis skipped: ${error.message || error}` };
  }
}

async function exportRootScreenshot(node, options = {}) {
  const maxSide = Math.max(finite(node.width), finite(node.height), 1);
  const target = Math.max(2400, Math.min(5000, finite(options.referenceMaxDimension, 4096)));
  const scale = Math.min(2, target / maxSide);
  try {
    const bytes = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: scale } });
    return { bytes, scale };
  } catch (_) {
    return { bytes: null, scale };
  }
}

async function buildPayload(options) {
  const selected = figma.currentPage.selection[0];
  if (!selected || selected.type === "SLICE") throw new Error("Выберите Frame, Component, Group или другой контейнер макета.");
  const state = { imageHashes: new Set(), vectorNodes: [] };
  const tree = refineLocalSemantics(await serializeNode(selected, null, 0, 1, state));
  const [tokens, baseAssets, screenshot] = await Promise.all([collectTokens(), exportAssets(state), exportRootScreenshot(selected, options)]);
  const assets = [...baseAssets];
  if (screenshot.bytes) assets.push({ key: "reference:root", kind: "reference", name: `${selected.name || "page"}-reference`, width: selected.width * screenshot.scale, height: selected.height * screenshot.scale, bytes: screenshot.bytes });
  const ai = await runAiSemanticAnalysis(tree, options);
  return {
    version: "7.0.0",
    generatedAt: new Date().toISOString(),
    root: tree,
    tokens,
    assets,
    originalScreenshot: screenshot.bytes,
    screenshotScale: screenshot.scale,
    referenceAssetKey: screenshot.bytes ? "reference:root" : null,
    aiMap: ai.map,
    warnings: ai.warning ? [ai.warning] : [],
    options: {
      webpQuality: finite(options.webpQuality, 0.82),
      maxImageDimension: finite(options.maxImageDimension, 3200),
      referenceMaxDimension: finite(options.referenceMaxDimension, 4096),
      responsive: options.responsive !== false,
      layoutStrategy: ["auto", "fidelity", "reflow"].includes(options.layoutStrategy) ? options.layoutStrategy : "auto",
      outputMode: ["smart", "exact", "editable"].includes(options.outputMode) ? options.outputMode : "smart",
      includeComponents: options.includeComponents !== false,
      includeReports: options.includeReports !== false,
      minify: Boolean(options.minify)
    }
  };
}

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === "get-settings") {
      figma.ui.postMessage({ type: "settings", settings: await figma.clientStorage.getAsync(SETTINGS_KEY) || {} });
      return;
    }
    if (message.type === "save-settings") {
      await figma.clientStorage.setAsync(SETTINGS_KEY, message.settings || {});
      figma.ui.postMessage({ type: "settings-saved" });
      return;
    }
    if (message.type === "resize") {
      figma.ui.resize(Math.max(760, message.width || 1120), Math.max(560, message.height || 780));
      return;
    }
    if (message.type === "generate") {
      figma.ui.postMessage({ type: "progress", step: "Читаю структуру макета…", progress: 0.08 });
      const payload = await buildPayload(message.options || {});
      figma.ui.postMessage({ type: "payload", payload, mode: message.mode || "preview" });
      return;
    }
    if (message.type === "close") figma.closePlugin();
  } catch (error) {
    figma.ui.postMessage({ type: "error", message: error && error.message ? error.message : String(error) });
  }
};
