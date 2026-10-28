// Connection test: report AE version and the open project, and check frame export works.
var info = [];
info.push("AE version: " + app.version + " (build " + app.buildName + ")");
info.push("Project: " + (app.project.file ? app.project.file.fsName : "(unsaved)") +
  ", items: " + app.project.numItems);

var comp = app.project.items.addComp("__remo_bridge_test", 320, 180, 1, 2, 30);
var solid = comp.layers.addSolid([1, 0.5, 0], "orange", 160, 90, 1);
var png = new File(Folder.temp.fsName + "/remo_bridge_test.png");
var frameExport = "n/a";
try {
  comp.saveFrameToPng(0, png);
  frameExport = "saveFrameToPng ok -> " + png.fsName;
} catch (e) {
  frameExport = "saveFrameToPng failed: " + e.toString();
}
// Removing the comp leaves the solid's footage item (and the Solids folder AE made for it).
var source = solid.source;
var folder = source.parentFolder;
comp.remove();
source.remove();
if (folder !== app.project.rootFolder && folder.numItems === 0) folder.remove();
info.push(frameExport);
info.push("Project items after cleanup: " + app.project.numItems);
info.join("\n");
