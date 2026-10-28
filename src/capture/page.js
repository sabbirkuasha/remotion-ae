// Runs inside the Remotion render page (injected by capture.ts). Plain browser JavaScript.
// Tracks elements across frames with stable identities, notes what React changes, and measures layers.
(() => {
  const canvas = document.querySelector("#remotion-canvas");
  if (!canvas) throw new Error("no #remotion-canvas in the page");
  const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text", "image", "use", "foreignObject"]);
  const NON_RENDERED = new Set(["defs", "clipPath", "mask", "linearGradient", "radialGradient", "pattern", "filter", "symbol", "marker", "style", "title", "desc", "metadata"]);

  // ------------------------------------------------------------ identity
  // React elements are identified by their position in the React tree (stable even when a <Sequence> remounts
  // them); markup React didn't create (dangerouslySetInnerHTML) by the nearest React element + child indexes.
  let fiberKey = null;
  const fiberOf = (el) => {
    if (!fiberKey) fiberKey = Object.keys(el).find((k) => k.startsWith("__reactFiber$")) ?? null;
    return fiberKey ? el[fiberKey] ?? null : null;
  };
  const pathIds = new Map();
  const idCache = new WeakMap();
  const live = new Map(); // id -> element in the page now
  function idOf(el) {
    const cached = idCache.get(el);
    if (cached) return cached;
    let id;
    const f = fiberOf(el);
    if (f) {
      const parts = [];
      for (let x = f; x; x = x.return) parts.push(`${x.key ?? ""}:${x.index}`);
      const path = parts.reverse().join("/");
      if (!pathIds.has(path)) pathIds.set(path, `e${pathIds.size + 1}`);
      id = pathIds.get(path);
    } else {
      const parent = el.parentElement;
      id = `${idOf(parent)}.${Array.prototype.indexOf.call(parent.children, el)}`;
    }
    idCache.set(el, id);
    return id;
  }
  function resolve(id) {
    const el = live.get(id);
    if (el && el.isConnected) return el;
    const dot = id.lastIndexOf(".");
    if (dot < 0) return null;
    const parent = resolve(id.slice(0, dot));
    return parent ? parent.children[Number(id.slice(dot + 1))] ?? null : null;
  }
  // What we know about each element, recorded while it is in the page (unmounted elements can't be asked later).
  const meta = new Map();
  const nearestFiber = (el) => {
    for (let x = el; x; x = x.parentElement) {
      const f = fiberOf(x);
      if (f) return f;
    }
    return null;
  };
  function describe(el) {
    const id = idOf(el);
    if (meta.has(id)) return;
    // <Sequence>s around it (outermost first), from React's tree
    const chain = [];
    for (let x = nearestFiber(el); x; x = x.return) {
      const t = x.type;
      const name = t && typeof t !== "string" ? t.displayName || t.name || "" : "";
      if (name === "Sequence" && x.memoizedProps) chain.push({ name: String(x.memoizedProps.name ?? ""), from: Number(x.memoizedProps.from ?? 0) });
    }
    // paint order: indexes from the root (React tree for React elements, then child indexes for plain markup)
    const order = [];
    let x = el;
    const domTail = [];
    while (x && !fiberOf(x)) {
      domTail.unshift(Array.prototype.indexOf.call(x.parentElement.children, x));
      x = x.parentElement;
    }
    for (let f = x ? fiberOf(x) : null; f; f = f.return) order.unshift(f.index);
    order.push(...domTail);
    let defs = null;
    for (let y = el; y && y !== canvas; y = y.parentElement) if (NON_RENDERED.has(y.localName)) defs = y;
    const named = el.id ? el : el.closest("[id]");
    meta.set(id, {
      chain: chain.reverse(),
      order,
      tag: el.localName,
      elementId: named && named !== canvas && canvas.contains(named) ? named.id : "",
      clip: defs ? (el.closest("clipPath")?.id ?? null) : null,
      nonRendered: !!defs,
    });
  }
  // Elements that start a new <Sequence> (their sequence chain differs from their parent's): each <Sequence> is a
  // layer in Remotion Studio, so it is one in After Effects too, even if nothing in it moves.
  const sequenceRoots = new Set();
  const sameChain = (a, b) => a.length === b.length && a.every((s, i) => s.name === b[i].name && s.from === b[i].from);
  // register the React elements in a subtree (walking through elements React didn't create, too)
  function registerTree(root) {
    const stack = [root];
    while (stack.length) {
      const el = stack.pop();
      for (const c of el.children) stack.push(c);
      if (!fiberOf(el)) continue;
      const id = idOf(el);
      live.set(id, el);
      describe(el);
      const parent = el !== canvas && el.parentElement ? meta.get(idOf(el.parentElement)) : null;
      if (parent && !sameChain(parent.chain, meta.get(id).chain)) sequenceRoots.add(id);
    }
  }

  // ------------------------------------------------------------ what changes from frame to frame
  const animated = new Set();
  const mounted = new Set();
  const blends = new Map(); // id -> CSS mix-blend-mode
  // A blend mode only mixes with what is inside its nearest isolated group (stacking context). Remember where that
  // is: when it lies inside the same layer, the blend is simply part of that layer's artwork.
  const isolates = (el) => {
    const cs = getComputedStyle(el);
    if (cs.isolation === "isolate" || cs.mixBlendMode !== "normal" || parseFloat(cs.opacity) < 1) return true;
    if (cs.filter !== "none" || cs.clipPath !== "none" || (cs.maskImage && cs.maskImage !== "none")) return true;
    return !(el instanceof SVGElement) && cs.transform !== "none";
  };
  const blendInfo = new Map(); // id -> { ancestors: ids from the parent upwards, isolatedAt: index into ancestors }
  function scanBlends(root) {
    for (const el of [root, ...root.querySelectorAll("*")]) {
      const mode = getComputedStyle(el).mixBlendMode;
      if (!mode || mode === "normal") continue;
      const id = idOf(el);
      blends.set(id, mode);
      describe(el);
      const ancestors = [];
      let isolatedAt = -1;
      for (let x = el.parentElement; x && x !== canvas.parentElement; x = x.parentElement) {
        if (isolatedAt < 0 && isolates(x)) isolatedAt = ancestors.length;
        ancestors.push(idOf(x));
      }
      blendInfo.set(id, { ancestors, isolatedAt: isolatedAt < 0 ? ancestors.length : isolatedAt });
    }
  }
  registerTree(canvas);
  scanBlends(canvas);
  // records delivered to the callback are gone from takeRecords(), so both paths process them
  const observer = new MutationObserver((records) => handle(records));
  observer.observe(canvas, { subtree: true, childList: true, attributes: true });
  const drain = () => handle(observer.takeRecords());
  function handle(records) {
    for (const r of records) {
      if (r.type === "attributes") {
        if (r.target.nodeType === 1 && r.target.isConnected) {
          describe(r.target);
          animated.add(idOf(r.target));
        }
      } else {
        for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          registerTree(n);
          mounted.add(idOf(n));
          scanBlends(n);
        }
        for (const n of r.removedNodes) if (n.nodeType === 1 && idCache.has(n)) mounted.add(idCache.get(n));
      }
    }
  }

  // ------------------------------------------------------------ measuring (all in composition pixels)
  const origin = () => {
    const c = canvas.getBoundingClientRect();
    return [c.left, c.top];
  };
  function matrixOf(el) {
    const [cx, cy] = origin();
    if (el instanceof SVGGraphicsElement) {
      const m = el.getScreenCTM();
      return m ? [m.a, m.b, m.c, m.d, m.e - cx, m.f - cy] : null;
    }
    // HTML: translation only for now (Phase 2 test material is SVG)
    const r = el.getBoundingClientRect();
    return [1, 0, 0, 1, r.left - cx, r.top - cy];
  }
  function opacityOf(el) {
    let o = 1;
    for (let x = el; x && x !== canvas.parentElement; x = x.parentElement) o *= parseFloat(getComputedStyle(x).opacity);
    return o;
  }
  const clipRef = (el) => {
    const v = getComputedStyle(el).clipPath;
    const m = /url\("?#([^")]+)"?\)/.exec(v || "");
    return m ? m[1] : null;
  };
  /** Animated clip paths on the element or its ancestors, as polygons in page coordinates. */
  function clipsOf(el, animatedClipIds) {
    const out = [];
    for (let x = el; x && x !== canvas; x = x.parentElement) {
      const ref = clipRef(x);
      if (!ref || !animatedClipIds.has(ref)) continue;
      const clip = document.getElementById(ref);
      const m = x.getScreenCTM ? x.getScreenCTM() : null;
      if (!clip || !m) continue;
      const [cx, cy] = origin();
      for (const s of clip.children) {
        if (s.localName !== "rect") continue; // rect clips for now
        const [rx, ry, w, h] = ["x", "y", "width", "height"].map((a) => s[a].baseVal.value);
        out.push([[rx, ry], [rx + w, ry], [rx + w, ry + h], [rx, ry + h]].map(([px, py]) => {
          const p = new DOMPoint(px, py).matrixTransform(m);
          return [p.x - cx, p.y - cy];
        }));
      }
    }
    return out;
  }
  const visible = (el) => !!el && el.isConnected && el.checkVisibility({ visibilityProperty: true });

  // ------------------------------------------------------------ artwork at rest
  let restore = [];
  const setStyle = (el, prop, value) => {
    const prev = [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)];
    el.style.setProperty(prop, value, "important");
    restore.push(() => (prev[0] ? el.style.setProperty(prop, prev[0], prev[1]) : el.style.removeProperty(prop)));
  };
  const setAttr = (el, name) => {
    el.setAttribute(name, "");
    restore.push(() => el.removeAttribute(name));
  };
  function ownBox(el, hidden) {
    // union of the visible shapes that belong to this layer (not to layers nested inside it)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const c = canvas.getBoundingClientRect();
    const walk = (node) => {
      if (hidden.has(node) || NON_RENDERED.has(node.localName)) return;
      const cs = getComputedStyle(node);
      if (cs.display === "none") return;
      const isShape = node instanceof SVGElement ? SHAPES.has(node.localName) : node.childElementCount === 0 || cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backgroundImage !== "none";
      if (isShape && cs.visibility !== "hidden") {
        const r = node.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) {
          x0 = Math.min(x0, r.left - c.left);
          y0 = Math.min(y0, r.top - c.top);
          x1 = Math.max(x1, r.right - c.left);
          y1 = Math.max(y1, r.bottom - c.top);
        }
      }
      if (node.localName !== "foreignObject") for (const ch of node.children) walk(ch);
    };
    walk(el);
    return x0 === Infinity ? null : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }
  function originOf(el) {
    const cs = getComputedStyle(el);
    const [ox, oy] = cs.transformOrigin.split(" ").map(parseFloat);
    if (el instanceof SVGGraphicsElement) {
      const m = el.getScreenCTM();
      const box = cs.transformBox;
      const local = box === "fill-box" || box === "stroke-box" ? (() => { const b = el.getBBox(); return new DOMPoint(b.x + ox, b.y + oy); })() : new DOMPoint(ox, oy);
      const p = local.matrixTransform(m);
      const [cx, cy] = origin();
      return [p.x - cx, p.y - cy];
    }
    const r = el.getBoundingClientRect();
    const [cx, cy] = origin();
    return [r.left - cx + ox, r.top - cy + oy];
  }

  window.__ae = {
    drain,
    /**
     * After stepping through the frames: the layer candidates (elements that change, mount/unmount, or blend),
     * the clip paths whose contents change, and what we know about each candidate.
     */
    summary() {
      drain();
      const layers = [];
      const clips = new Set();
      const canvasId = idOf(canvas);
      const candidates = new Set([...animated, ...mounted, ...sequenceRoots]);
      // a blending element is its own layer only when it blends with things outside its layer
      const blendLayers = [...blends.keys()].filter((id) => {
        const { ancestors, isolatedAt } = blendInfo.get(id);
        const layerAt = ancestors.findIndex((a) => candidates.has(a));
        return layerAt < 0 || isolatedAt > layerAt;
      });
      for (const id of new Set([...candidates, ...blendLayers])) {
        const m = meta.get(id);
        if (!m || id === canvasId) continue;
        if (m.nonRendered) {
          if (m.clip) clips.add(m.clip);
          continue;
        }
        layers.push(id);
      }
      return {
        layers,
        animated: [...animated],
        clips: [...clips],
        blends: Object.fromEntries(blendLayers.map((id) => [id, blends.get(id)])),
        meta: Object.fromEntries(layers.map((id) => [id, meta.get(id)])),
      };
    },
    /** Per id: transform matrix (page px), opacity (cumulative) and animated clips, when visible. */
    sample(ids, animatedClipIds) {
      drain();
      const clipSet = new Set(animatedClipIds);
      const out = {};
      for (const id of ids) {
        const el = resolve(id);
        if (!visible(el)) continue;
        out[id] = { m: matrixOf(el), o: opacityOf(el), clips: clipSet.size ? clipsOf(el, clipSet) : [] };
      }
      return out;
    },
    /**
     * Show only this layer's own artwork, at rest: animated transforms off, opacity 1, animated clips off, nested
     * layers hidden. `id` null = everything that belongs to no layer (static content). Returns its bounds, rest
     * matrix and transform origin (page px), or null when it draws nothing.
     */
    isolate(id, layerIds, animatedIds, animatedClipIds, margin) {
      drain();
      restore = [];
      const el = id ? resolve(id) : canvas;
      if (!el) return null;
      const hidden = new Set(layerIds.filter((l) => l !== id).map(resolve).filter((x) => x && x !== el && el.contains(x)));
      const animatedSet = new Set(animatedIds);
      const clipSet = new Set(animatedClipIds);
      for (let x = el; x && x !== canvas.parentElement; x = x.parentElement) {
        if (x !== canvas && x !== el && animatedSet.has(idOf(x))) setStyle(x, "transform", "none");
        if (x === el && id) setStyle(x, "transform", "none");
        setStyle(x, "opacity", "1");
        const ref = clipRef(x);
        if (ref && clipSet.has(ref)) setStyle(x, "clip-path", "none");
      }
      const style = document.createElement("style");
      // the show/hide rules need the id too, or `#remotion-canvas *` outranks them. Definitions stay visible: a clip
      // path whose shapes are hidden clips everything away.
      style.textContent =
        "html, body { background: transparent !important; }" +
        "#remotion-canvas * { visibility: hidden !important; }" +
        "#remotion-canvas defs, #remotion-canvas defs *, #remotion-canvas clipPath, #remotion-canvas clipPath *, " +
        "#remotion-canvas mask, #remotion-canvas mask *, #remotion-canvas pattern, #remotion-canvas pattern *, " +
        "#remotion-canvas symbol, #remotion-canvas symbol * { visibility: visible !important; }" +
        "#remotion-canvas[data-ae-show], #remotion-canvas[data-ae-show] *, #remotion-canvas [data-ae-show], " +
        "#remotion-canvas [data-ae-show] * { visibility: visible !important; }" +
        "#remotion-canvas [data-ae-hide], #remotion-canvas [data-ae-hide] * { visibility: hidden !important; }";
      document.head.appendChild(style);
      restore.push(() => style.remove());
      setAttr(el, "data-ae-show");
      for (const h of hidden) setAttr(h, "data-ae-hide");
      const box = ownBox(el, hidden);
      if (!box) return null;
      const m = margin;
      return {
        box: { x: box.x - m, y: box.y - m, width: box.width + 2 * m, height: box.height + 2 * m },
        rest: id ? matrixOf(el) : [1, 0, 0, 1, 0, 0],
        origin: id ? originOf(el) : [box.x + box.width / 2, box.y + box.height / 2],
      };
    },
    /** Move and scale the composition so `box` (page px) fills the top-left of the page at `scale`. */
    frameRegion(box, scale) {
      const c = canvas.getBoundingClientRect();
      for (let x = canvas; x && x !== document.body; x = x.parentElement) setStyle(x, "overflow", "visible");
      for (const svg of canvas.querySelectorAll("svg")) {
        const r = svg.getBoundingClientRect();
        if (Math.abs(r.width - c.width) < 1 && Math.abs(r.height - c.height) < 1) setStyle(svg, "overflow", "visible");
      }
      setStyle(canvas, "transform-origin", "0 0");
      setStyle(canvas, "transform", `translate(${-box.x * scale - c.left}px, ${-box.y * scale - c.top}px) scale(${scale})`);
    },
    restore() {
      for (const fn of restore.reverse()) fn();
      restore = [];
    },
    /** Diagnostics: how ids resolve right now. */
    debug(ids) {
      return ids.map((id) => {
        const el = resolve(id);
        return el
          ? { id, tag: el.localName, connected: el.isConnected, checkVisibility: el.checkVisibility({ visibilityProperty: true }), display: getComputedStyle(el).display }
          : { id, resolved: false, inLive: live.has(id) };
      });
    },
  };
})();
