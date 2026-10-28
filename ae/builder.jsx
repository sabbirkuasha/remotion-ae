// remotion-ae builder: creates a Scene (see src/ir.ts) in the open After Effects project.
// ExtendScript (ES3). The exporter appends the call: remotionAE.build(<scene>, <options>);
var remotionAE = (function () {
  var warnings;
  var expressions; // properties given an expression; checked once everything exists

  function isArray(v) { return v instanceof Array; }
  function isObject(v) { return v !== null && typeof v === "object" && !(v instanceof Array); }

  // ---------------------------------------------------------------- folders and footage

  function childFolder(parent, name) {
    for (var i = 1; i <= parent.numItems; i++) {
      var it = parent.item(i);
      if (it instanceof FolderItem && it.name === name) return it;
    }
    var f = app.project.items.addFolder(name);
    f.parentFolder = parent;
    return f;
  }

  function folderAt(root, path) {
    if (!path) return root;
    var parts = path.split("/");
    var f = root;
    for (var i = 0; i < parts.length; i++) f = childFolder(f, parts[i]);
    return f;
  }

  function resolveFile(spec, scriptDir) {
    if (spec.rel && scriptDir) {
      var rel = new File(scriptDir.fsName + "/" + spec.rel);
      if (rel.exists) return rel;
    }
    var abs = new File(spec.file);
    if (abs.exists) return abs;
    throw new Error("File not found: " + spec.file);
  }

  function importFootage(spec, root, scriptDir) {
    var opts = new ImportOptions(resolveFile(spec, scriptDir));
    if (opts.canImportAs(ImportAsType.FOOTAGE)) opts.importAs = ImportAsType.FOOTAGE;
    opts.sequence = false;
    var item = app.project.importFile(opts);
    item.parentFolder = folderAt(root, spec.folder);
    return item;
  }

  // ---------------------------------------------------------------- values and keyframes

  function aeValue(prop, v) {
    if (isObject(v) && v.vertices) {
      var s = new Shape();
      s.vertices = v.vertices;
      s.closed = v.closed;
      return s;
    }
    if (isArray(v) && v.length === 3 && prop.propertyValueType === PropertyValueType.COLOR) return [v[0], v[1], v[2], 1];
    return v;
  }

  function interpType(name) {
    if (name === "hold") return KeyframeInterpolationType.HOLD;
    if (name === "bezier") return KeyframeInterpolationType.BEZIER;
    return KeyframeInterpolationType.LINEAR;
  }

  function easeList(prop, idx, pair, dims, incoming) {
    var current = incoming ? prop.keyInTemporalEase(idx) : prop.keyOutTemporalEase(idx);
    if (!pair) return current;
    var list = [];
    for (var d = 0; d < dims; d++) list.push(new KeyframeEase(pair[0], pair[1]));
    return list;
  }

  /** Apply an Anim (constant, {keys}, or {expr}) to a property. Key frames are comp frames. */
  function setAnim(prop, anim, fps) {
    if (anim === undefined || anim === null) return;
    if (isObject(anim) && anim.expr !== undefined) {
      if (anim.v !== undefined) prop.setValue(aeValue(prop, anim.v));
      prop.expression = anim.expr;
      // property objects go stale as the layer gets more properties; keep the layer and the index path
      var path = [];
      var p = prop;
      while (p.propertyDepth > 0) {
        path.unshift(p.propertyIndex);
        p = p.parentProperty;
      }
      expressions.push({ layer: p, path: path });
      return;
    }
    if (!(isObject(anim) && anim.keys !== undefined)) {
      prop.setValue(aeValue(prop, anim));
      return;
    }
    var keys = anim.keys;
    // isSpatial is also true for effect points, which take no spatial tangents
    var spatial = prop.propertyValueType === PropertyValueType.TwoD_SPATIAL ||
      prop.propertyValueType === PropertyValueType.ThreeD_SPATIAL;
    var i;
    for (i = 0; i < keys.length; i++) prop.setValueAtTime(keys[i].f / fps, aeValue(prop, keys[i].v));
    for (i = 0; i < keys.length; i++) {
      var k = keys[i];
      var idx = prop.nearestKeyIndex(k.f / fps);
      var type = k.ease ? KeyframeInterpolationType.BEZIER : interpType(k.interp);
      var prevHold = i > 0 && keys[i - 1].interp === "hold";
      var inType = type === KeyframeInterpolationType.HOLD ? KeyframeInterpolationType.LINEAR : type;
      prop.setInterpolationTypeAtKey(idx, prevHold ? KeyframeInterpolationType.HOLD : inType, type);
      if (k.ease) {
        var dims = spatial || !isArray(k.v) ? 1 : k.v.length;
        prop.setTemporalEaseAtKey(idx, easeList(prop, idx, k.ease["in"], dims, true), easeList(prop, idx, k.ease.out, dims, false));
      }
      if (spatial && keys.length > 1) {
        // straight motion paths, like CSS transforms
        var zero = [];
        for (var z = 0; z < prop.value.length; z++) zero.push(0);
        prop.setSpatialContinuousAtKey(idx, false);
        prop.setSpatialAutoBezierAtKey(idx, false);
        prop.setSpatialTangentsAtKey(idx, zero, zero);
      }
    }
  }

  // ---------------------------------------------------------------- text

  function applyTextStyle(prop, t, text) {
    var td = prop.value;
    td.resetCharStyle();
    td.resetParagraphStyle();
    td.text = text;
    td.font = t.font;
    td.fontSize = t.size;
    td.applyFill = true;
    td.fillColor = t.fill;
    td.applyStroke = false;
    td.tracking = 0;
    td.fauxBold = false;
    td.fauxItalic = !!t.fauxItalic;
    td.justification =
      t.justify === "left" ? ParagraphJustification.LEFT_JUSTIFY :
      t.justify === "right" ? ParagraphJustification.RIGHT_JUSTIFY : ParagraphJustification.CENTER_JUSTIFY;
    if (t.leading !== undefined) {
      td.autoLeading = false;
      td.leading = t.leading;
    }
    if (t.universalEngine) td.composerEngine = ComposerEngine.UNIVERSAL_TYPE_ENGINE;
    if (t.scriptFonts) {
      for (var s = 0; s < t.scriptFonts.length; s++) {
        var re = new RegExp("[" + t.scriptFonts[s].chars + "]");
        var runStart = -1;
        for (var c = 0; c <= text.length; c++) {
          var inRun = c < text.length && re.test(text.charAt(c));
          if (inRun && runStart < 0) runStart = c;
          if (!inRun && runStart >= 0) {
            var range = td.characterRange(runStart, c);
            range.font = t.scriptFonts[s].font;
            if (t.scriptFonts[s].fauxItalic) range.fauxItalic = true;
            runStart = -1;
          }
        }
      }
    }
    prop.setValue(td);
  }

  /**
   * Advance width of a line, which is what browsers wrap by. sourceRectAtTime measures ink, which is narrower;
   * bracketing the text with "|" and subtracting "||" cancels the side bearings.
   */
  function advanceWidth(layer, prop, t, text) {
    applyTextStyle(prop, t, "|" + text + "|");
    var bracketed = layer.sourceRectAtTime(layer.inPoint, false).width;
    applyTextStyle(prop, t, "||");
    return bracketed - layer.sourceRectAtTime(layer.inPoint, false).width;
  }

  /** Greedy word wrap at wrapWidth, measured with the real font. Spaces become line breaks, so indexes don't move. */
  function wrapText(layer, prop, t, text) {
    var paragraphs = text.split("\r");
    var out = [];
    for (var p = 0; p < paragraphs.length; p++) {
      var words = paragraphs[p].split(" ");
      var line = "";
      for (var w = 0; w < words.length; w++) {
        var candidate = line === "" ? words[w] : line + " " + words[w];
        if (line !== "" && advanceWidth(layer, prop, t, candidate) > t.wrapWidth) {
          out.push(line);
          line = words[w];
        } else {
          line = candidate;
        }
      }
      out.push(line);
    }
    return out.join("\r");
  }

  function applyText(layer, t) {
    var prop = layer.property("ADBE Text Properties").property("ADBE Text Document");
    var text = t.text.replace(/\r\n|\n/g, "\r");
    if (t.wrapWidth) {
      var wrapped = wrapText(layer, prop, t, text);
      if (wrapped !== text) warnings.push('"' + layer.name + '" wrapped to ' + wrapped.split("\r").length + " lines");
      text = wrapped;
    }
    applyTextStyle(prop, t, text);
  }

  // ---------------------------------------------------------------- layers

  function addShapes(layer, shapes, fps) {
    var contents = layer.property("ADBE Root Vectors Group");
    for (var i = 0; i < shapes.length; i++) {
      var s = shapes[i];
      var group = contents.addProperty("ADBE Vector Group");
      if (s.name) group.name = s.name;
      var vectors = group.property("ADBE Vectors Group");
      var rect = vectors.addProperty("ADBE Vector Shape - Rect");
      setAnim(rect.property("ADBE Vector Rect Size"), s.size, fps);
      setAnim(rect.property("ADBE Vector Rect Position"), s.position, fps);
      setAnim(rect.property("ADBE Vector Rect Roundness"), s.roundness, fps);
      var fill = vectors.addProperty("ADBE Vector Graphic - Fill");
      fill.property("ADBE Vector Fill Color").setValue([s.fill[0], s.fill[1], s.fill[2], 1]);
      setAnim(fill.property("ADBE Vector Fill Opacity"), s.fillOpacity, fps);
    }
  }

  var BLEND = { normal: "NORMAL", screen: "SCREEN", add: "ADD", subtract: "SUBTRACT", multiply: "MULTIPLY", overlay: "OVERLAY" };
  var MATTE = { alpha: "ALPHA", "alpha-inverted": "ALPHA_INVERTED", luma: "LUMA", "luma-inverted": "LUMA_INVERTED" };
  var MASK_MODE = { add: "ADD", subtract: "SUBTRACT", intersect: "INTERSECT", none: "NONE" };

  function addLayer(comp, spec, ctx) {
    var fps = comp.frameRate;
    var layer;
    if (spec.kind === "footage") layer = comp.layers.add(ctx.footage[spec.footage]);
    else if (spec.kind === "comp") layer = comp.layers.add(ctx.comps[spec.comp]);
    else if (spec.kind === "solid") {
      layer = comp.layers.addSolid(spec.color, spec.name || "Solid", spec.width, spec.height, 1);
      layer.source.parentFolder = folderAt(ctx.root, "Solids");
    } else if (spec.kind === "text") layer = comp.layers.addText();
    else if (spec.kind === "shape") layer = comp.layers.addShape();
    else throw new Error("Unknown layer kind: " + spec.kind);
    if (spec.name) layer.name = spec.name;

    // timing: source time 0 at `start`, visible [in, out)
    layer.startTime = (spec.start !== undefined ? spec.start : spec["in"]) / fps;
    var inT = spec["in"] / fps;
    var outT = spec.out !== undefined ? spec.out / fps : Math.min(layer.outPoint, comp.duration);
    if (inT < layer.outPoint) {
      layer.inPoint = inT;
      layer.outPoint = outT;
    } else {
      layer.outPoint = outT;
      layer.inPoint = inT;
    }

    if (spec.kind === "text") applyText(layer, spec.text);
    if (spec.kind === "shape") addShapes(layer, spec.shapes, fps);

    var tr = spec.transform || {};
    var group = layer.property("ADBE Transform Group");
    setAnim(group.property("ADBE Anchor Point"), tr.anchor, fps);
    setAnim(group.property("ADBE Position"), tr.position, fps);
    setAnim(group.property("ADBE Scale"), tr.scale, fps);
    setAnim(group.property("ADBE Rotate Z"), tr.rotation, fps);
    setAnim(group.property("ADBE Opacity"), tr.opacity, fps);

    if (spec.blend) layer.blendingMode = BlendingMode[BLEND[spec.blend]];
    if (spec.enabled === false) layer.enabled = false;
    if (spec.comment) layer.comment = spec.comment;

    var i, m;
    if (spec.effects) {
      var parade = layer.property("ADBE Effect Parade");
      for (i = 0; i < spec.effects.length; i++) {
        var fx = spec.effects[i];
        var effect = parade.addProperty(fx.match);
        if (fx.name) effect.name = fx.name;
        for (m in fx.props) if (fx.props.hasOwnProperty(m)) setAnim(effect.property(m), fx.props[m], fps);
      }
    }
    if (spec.masks) {
      var masks = layer.property("ADBE Mask Parade");
      for (i = 0; i < spec.masks.length; i++) {
        var ms = spec.masks[i];
        var mask = masks.addProperty("ADBE Mask Atom");
        mask.maskMode = MaskMode[MASK_MODE[ms.mode || "add"]];
        if (ms.inverted) mask.inverted = true;
        setAnim(mask.property("ADBE Mask Shape"), ms.path, fps);
        setAnim(mask.property("ADBE Mask Feather"), ms.feather, fps);
        setAnim(mask.property("ADBE Mask Opacity"), ms.opacity, fps);
        setAnim(mask.property("ADBE Mask Offset"), ms.expansion, fps);
      }
    }
    if (spec.audio && layer.hasAudio) {
      layer.audioEnabled = spec.audio.enabled;
      setAnim(layer.property("ADBE Audio Group").property("ADBE Audio Levels"), spec.audio.levels, fps);
    }
    return layer;
  }

  function buildComp(c, ctx) {
    var comp = app.project.items.addComp(c.name, c.width, c.height, 1, c.frames / c.fps, c.fps);
    comp.parentFolder = folderAt(ctx.root, c.folder);
    if (c.bg) comp.bgColor = c.bg;
    var i;
    // AE puts each new layer on top, so add bottom-up
    for (i = c.layers.length - 1; i >= 0; i--) addLayer(comp, c.layers[i], ctx);
    for (i = 0; i < c.layers.length; i++) {
      var spec = c.layers[i];
      if (spec.matte) comp.layer(i + 1).setTrackMatte(comp.layer(spec.matte.layer), TrackMatteType[MATTE[spec.matte.type]]);
    }
    return comp;
  }

  // ---------------------------------------------------------------- entry points

  /**
   * Build a scene. options.replace: first delete an existing top-level folder with the scene's name
   * (used by tests; users get a fresh copy next to the old one).
   */
  function build(scene, options) {
    options = options || {};
    warnings = [];
    expressions = [];
    if (scene.version !== 1) throw new Error("Unsupported scene version " + scene.version);
    var scriptDir = null;
    try { scriptDir = new File($.fileName).parent; } catch (e) {}

    app.beginUndoGroup("Import " + scene.name);
    try {
      if (options.replace) {
        for (var r = app.project.rootFolder.numItems; r >= 1; r--) {
          var old = app.project.rootFolder.item(r);
          if (old instanceof FolderItem && old.name === scene.name) old.remove();
        }
      }
      var root = app.project.items.addFolder(scene.name);
      var ctx = { root: root, footage: {}, comps: {} };
      var i;
      for (i = 0; i < scene.footage.length; i++) ctx.footage[scene.footage[i].id] = importFootage(scene.footage[i], root, scriptDir);
      var layers = 0;
      for (i = 0; i < scene.comps.length; i++) {
        ctx.comps[scene.comps[i].id] = buildComp(scene.comps[i], ctx);
        layers += scene.comps[i].layers.length;
      }
      for (i = 0; i < expressions.length; i++) {
        var e = expressions[i];
        var p = e.layer;
        for (var d = 0; d < e.path.length; d++) p = p.property(e.path[d]);
        p.valueAtTime(e.layer.inPoint, false);
        if (p.expressionError) {
          warnings.push("expression error on " + e.layer.containingComp.name + " > " + e.layer.name + " > " + p.name + ": " + p.expressionError);
        }
      }
      var main = ctx.comps[scene.main];
      remotionAE.main = main;
      if (!options.noViewer) main.openInViewer();
      var summary = 'Built "' + scene.name + '": ' + scene.comps.length + " comps, " + layers + " layers, " +
        scene.footage.length + " footage items";
      if (warnings.length) summary += "\nnotes:\n  " + warnings.join("\n  ");
      try { writeLn(summary.split("\n")[0]); } catch (e) {} // Info panel, for people running the script by hand
      return summary;
    } finally {
      app.endUndoGroup();
    }
  }

  /** Save frames of a comp as PNGs (dir/ae_00012.png). Used by tools/compare.ts. */
  function saveFrames(comp, frames, dir) {
    for (var i = 0; i < frames.length; i++) {
      var n = String(frames[i]);
      while (n.length < 5) n = "0" + n;
      comp.saveFrameToPng(frames[i] / comp.frameRate, new File(dir + "/ae_" + n + ".png"));
    }
    return frames.length + " frames saved";
  }

  return { build: build, saveFrames: saveFrames, main: null };
})();
