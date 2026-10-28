// Blur calibration: renders the vertical fixture's backdrop (cover x1.15, Levels 0.55) at several Gaussian Blur
// strengths. Run through tools/calibrate-blur.ts, which defines FIXTURE_IMAGE and OUT_DIR and scores the frames
// against remo's. Everything it creates in the project is removed again.
(function () {
  var fixture = FIXTURE_IMAGE;
  var outDir = OUT_DIR;
  var cover = Math.max(1080 / 1376, 1920 / 768);
  var factors = [1, 1.5, 2, 2.5, 3, 3.5, 4];
  var item = app.project.importFile(new ImportOptions(new File(fixture)));
  var comp = app.project.items.addComp("__calibrate_blur", 1080, 1920, 1, 1, 30);
  var layer = comp.layers.add(item);
  layer.property("ADBE Transform Group").property("ADBE Scale").setValue([cover * 115, cover * 115]);
  var fx = layer.property("ADBE Effect Parade");
  fx.addProperty("ADBE Gaussian Blur 2");
  fx.addProperty("ADBE Easy Levels2");
  fx = layer.property("ADBE Effect Parade");
  fx.property(1).property("ADBE Gaussian Blur 2-0003").setValue(1);
  fx.property(2).property("ADBE Easy Levels2-0007").setValue(0.55);
  new Folder(outDir).create();
  for (var i = 0; i < factors.length; i++) {
    layer.property("ADBE Effect Parade").property(1).property("ADBE Gaussian Blur 2-0001").setValue((40 * factors[i]) / cover);
    comp.saveFrameToPng(0, new File(outDir + "/blur_" + factors[i] + ".png"));
  }
  comp.remove();
  item.remove();
  return factors.join(",");
})();
