// List a built project's structure: comps, layers (time range, source, blend, matte, effects, keyframes, audio).
// Usage: set INSPECT_FOLDER below via tools/inspect.ts, which prepends `var INSPECT_FOLDER = "...";`.
(function () {
  function fmt(t) { return (Math.round(t * 1000) / 1000) + "s"; }
  var root = null;
  for (var i = 1; i <= app.project.rootFolder.numItems; i++) {
    var it = app.project.rootFolder.item(i);
    if (it instanceof FolderItem && it.name === INSPECT_FOLDER) root = it;
  }
  if (!root) throw new Error("no folder named " + INSPECT_FOLDER);
  var out = [];
  function walk(folder, path) {
    for (var i = 1; i <= folder.numItems; i++) {
      var item = folder.item(i);
      if (item instanceof FolderItem) { walk(item, path + item.name + "/"); continue; }
      if (!(item instanceof CompItem)) { out.push(path + item.name); continue; }
      out.push(path + item.name + "  [comp " + item.width + "x" + item.height + " " + item.frameRate + "fps " + fmt(item.duration) + "]");
      for (var l = 1; l <= item.numLayers; l++) {
        var layer = item.layer(l);
        var bits = [l + " " + layer.name, fmt(layer.inPoint) + "-" + fmt(layer.outPoint)];
        if (layer.startTime !== layer.inPoint) bits.push("start " + fmt(layer.startTime));
        if (layer.blendingMode !== BlendingMode.NORMAL) bits.push("blend " + layer.blendingMode);
        if (layer.hasTrackMatte) bits.push("matte " + layer.trackMatteLayer.name);
        if (!layer.enabled) bits.push("hidden");
        var fx = layer.property("ADBE Effect Parade");
        var names = [];
        for (var e = 1; e <= fx.numProperties; e++) names.push(fx.property(e).name);
        if (names.length) bits.push("fx: " + names.join(", "));
        var tr = layer.property("ADBE Transform Group");
        var keyed = [];
        for (var p = 1; p <= tr.numProperties; p++) {
          var prop = tr.property(p);
          if (prop.numKeys) keyed.push(prop.name + " x" + prop.numKeys);
          else if (prop.expressionEnabled) keyed.push(prop.name + " (expr)");
        }
        if (keyed.length) bits.push("anim: " + keyed.join(", "));
        if (layer.hasAudio) {
          var levels = layer.property("ADBE Audio Group").property("ADBE Audio Levels");
          bits.push("audio " + (layer.audioEnabled ? "on" : "off") + (levels.numKeys ? " levels x" + levels.numKeys : " " + levels.value[0] + "dB"));
        }
        out.push("    " + bits.join(" | "));
      }
    }
  }
  walk(root, "");
  return out.join("\n");
})();
