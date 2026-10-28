// Remotion Importer: an After Effects panel that imports a Remotion animation as layers, keyframes and masks.
// Install with `npm run install-panel` (copies this file into After Effects' ScriptUI Panels folder), restart
// After Effects, then open Window > Remotion Importer.jsx. Can also be run once via File > Scripts > Run Script File.
// The work is done by remotion-ae's capture (Node.js) in the background; this panel starts it, shows its progress,
// and builds the result into the open project. ExtendScript (ES3) + ScriptUI. Windows for now.
(function (thisObj) {
  // filled in by the installer; when run from the repository, the repository is the folder above ae/
  var REMOTION_AE = "@@REMOTION_AE_DIR@@";
  if (REMOTION_AE.indexOf("@@") === 0) REMOTION_AE = new File($.fileName).parent.parent.fsName.replace(/\\/g, "/");
  var CAPTURE = REMOTION_AE + "/src/capture-cli.ts";
  var SETTINGS = "remotionAE";

  // ------------------------------------------------------------------ helpers

  function setting(key, fallback) {
    return app.settings.haveSetting(SETTINGS, key) ? app.settings.getSetting(SETTINGS, key) : fallback;
  }
  function saveSetting(key, value) {
    app.settings.saveSetting(SETTINGS, key, value);
  }
  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }
  function readText(file) {
    if (!file.exists) return null;
    file.encoding = "UTF-8";
    if (!file.open("r")) return null;
    var text = file.read();
    file.close();
    return text;
  }
  function canWriteFiles() {
    try {
      var f = new File(Folder.temp.fsName + "/remotion-ae-write-test.txt");
      if (!f.open("w")) return false;
      f.write("ok");
      f.close();
      f.remove();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** node.exe, if Node.js 22.18+ is installed. Returns { path, version } or { error }. */
  function findNode() {
    // every folder on the PATH, then the usual install places (standard installer, Volta, nvm-windows)
    var candidates = [];
    var dirs = ($.getenv("PATH") || "").split(";");
    for (var d = 0; d < dirs.length; d++) if (trim(dirs[d])) candidates.push(trim(dirs[d]).replace(/[\\\/]$/, "") + "/node.exe");
    candidates.push("C:/Program Files/nodejs/node.exe", "C:/Program Files/Volta/node.exe");
    if ($.getenv("NVM_SYMLINK")) candidates.push($.getenv("NVM_SYMLINK") + "/node.exe");
    for (var i = 0; i < candidates.length; i++) {
      var exe = new File(trim(candidates[i]));
      if (!exe.exists) continue;
      // called directly: system.callSystem returns nothing for commands wrapped in `cmd /c`
      var version = trim(system.callSystem('"' + exe.fsName + '" --version'));
      var m = /^v(\d+)\.(\d+)/.exec(version);
      if (!m) continue;
      var major = Number(m[1]), minor = Number(m[2]);
      if (major > 22 || (major === 22 && minor >= 18)) return { path: exe.fsName, version: version };
      return { error: "Node.js " + version + " is too old: version 22.18 or newer is needed (nodejs.org)." };
    }
    return { error: "Node.js is not installed. Install it from nodejs.org (version 22.18 or newer), then reopen this panel." };
  }

  /** Start a command line without a window and without waiting (VBScript's Run, window style 0). */
  function runHidden(commandLine) {
    var vbs = new File(Folder.temp.fsName + "/remotion-ae-run.vbs");
    vbs.encoding = "UTF-8";
    vbs.open("w");
    vbs.write('CreateObject("WScript.Shell").Run "' + commandLine.replace(/"/g, '""') + '", 0, False');
    vbs.close();
    system.callSystem('wscript.exe //nologo "' + vbs.fsName + '"');
  }

  // ------------------------------------------------------------------ the panel

  var w = thisObj instanceof Panel ? thisObj : new Window("palette", "Remotion Importer", undefined, { resizeable: true });
  w.orientation = "column";
  w.alignChildren = ["fill", "top"];
  w.spacing = 8;
  w.margins = 12;

  w.add("statictext", undefined, "Import a Remotion animation as After Effects layers.");

  var row1 = w.add("group");
  row1.alignChildren = ["left", "center"];
  row1.add("statictext", undefined, "Project:").preferredSize.width = 80;
  var projectText = row1.add("edittext", undefined, setting("projectDir", ""));
  projectText.preferredSize.width = 260;
  projectText.alignment = ["fill", "center"];
  var browseButton = row1.add("button", undefined, "Browse...");

  var row2 = w.add("group");
  row2.alignChildren = ["left", "center"];
  row2.add("statictext", undefined, "Composition:").preferredSize.width = 80;
  var compList = row2.add("dropdownlist", undefined, []);
  compList.preferredSize.width = 260;
  compList.alignment = ["fill", "center"];
  var refreshButton = row2.add("button", undefined, "Refresh");

  var row3 = w.add("group");
  row3.alignChildren = ["left", "center"];
  row3.add("statictext", undefined, "Quality:").preferredSize.width = 80;
  var quality = row3.add("dropdownlist", undefined, ["1x (smallest files)", "2x (sharp, recommended)", "3x (for scaling up)"]);
  quality.selection = Number(setting("quality", "1"));
  // off by default: replacing deletes the earlier import, including any edits made to it
  var replaceBox = row3.add("checkbox", undefined, "Replace an earlier import");
  replaceBox.value = setting("replace", "false") === "true";

  var importButton = w.add("button", undefined, "Import into this project");
  var bar = w.add("progressbar", undefined, 0, 100);
  bar.preferredSize.height = 8;
  var statusText = w.add("statictext", undefined, "", { multiline: true });
  statusText.preferredSize = [380, 64];
  statusText.alignment = ["fill", "top"];
  var installButton = w.add("button", undefined, "Install the project's dependencies (npm install)");
  installButton.visible = false;

  function say(text) {
    statusText.text = text;
  }

  // ------------------------------------------------------------------ background jobs
  // A job runs node in the background and keeps a status file up to date; poll() follows it every 400 ms.

  var job = null;

  function busy(on) {
    browseButton.enabled = refreshButton.enabled = importButton.enabled = installButton.enabled = !on;
  }

  /** Run capture-cli with these arguments; `done(status)` gets the final status (state "done" or "error"). */
  function startCapture(args, weightOf, done) {
    var node = findNode();
    if (node.error) return say(node.error);
    var stamp = new Date().getTime();
    var statusFile = new File(Folder.temp.fsName + "/remotion-ae-" + stamp + ".json");
    var logFile = new File(Folder.temp.fsName + "/remotion-ae-" + stamp + ".log");
    var quoted = '"' + node.path + '" "' + new File(CAPTURE).fsName + '"';
    for (var i = 0; i < args.length; i++) quoted += ' "' + args[i] + '"';
    quoted += ' --progress "' + statusFile.fsName + '" > "' + logFile.fsName + '" 2>&1';
    runHidden('cmd /s /c "' + quoted + '"');
    startJob({ statusFile: statusFile, logFile: logFile, weightOf: weightOf, done: done, started: stamp });
  }

  /** Run a plain command line in the background; done when it writes its exit code. */
  function startCommand(commandLine, cwd, message, done) {
    var stamp = new Date().getTime();
    var exitFile = new File(Folder.temp.fsName + "/remotion-ae-" + stamp + ".exit");
    var logFile = new File(Folder.temp.fsName + "/remotion-ae-" + stamp + ".log");
    // delayed expansion (/v:on, !errorlevel!): %errorlevel% would be read before the command runs
    runHidden('cmd /v:on /s /c "cd /d "' + cwd + '" && ' + commandLine + ' > "' + logFile.fsName + '" 2>&1 & echo !errorlevel! > "' + exitFile.fsName + '""');
    say(message);
    startJob({ exitFile: exitFile, logFile: logFile, done: done, started: stamp, message: message });
  }

  function startJob(j) {
    busy(true);
    bar.value = 0;
    job = j;
    job.task = app.scheduleTask("$.global.remotionAEPanel.poll()", 400, true);
  }

  function finish(result) {
    app.cancelTask(job.task);
    var j = job;
    job = null;
    busy(false);
    j.done(result);
  }

  function logTail(file) {
    var text = readText(file) || "";
    var lines = trim(text).split(/\r?\n/);
    return lines.slice(Math.max(0, lines.length - 4)).join("\n");
  }

  function poll() {
    if (!job) return;
    var seconds = Math.round((new Date().getTime() - job.started) / 1000);
    if (job.exitFile) {
      var code = readText(job.exitFile);
      if (code === null || trim(code) === "") return say(job.message + " (" + seconds + " s)");
      return finish({ state: trim(code) === "0" ? "done" : "error", error: logTail(job.logFile) });
    }
    var text = readText(job.statusFile);
    if (text === null) {
      // no status yet: still starting, or node failed before it could write one
      var log = readText(job.logFile);
      if (seconds > 20 && log && /error/i.test(log)) return finish({ state: "error", error: logTail(job.logFile) });
      return say("Starting... (" + seconds + " s)");
    }
    var s;
    try {
      s = eval("(" + text + ")");
    } catch (e) {
      return; // being rewritten
    }
    if (s.state === "running") {
      bar.value = job.weightOf ? job.weightOf(s) : 0;
      return say(s.message + "  (" + seconds + " s)");
    }
    finish(s);
  }

  $.global.remotionAEPanel = { poll: poll };

  // ------------------------------------------------------------------ actions

  function projectDir() {
    return trim(projectText.text).replace(/\\/g, "/").replace(/\/$/, "");
  }

  function showInstall(on) {
    if (installButton.visible === on) return;
    installButton.visible = on;
    w.layout.layout(true);
  }

  /** Checks before running anything; returns an error message or null. */
  function problems(dir) {
    if ($.os.indexOf("Windows") < 0) return "This panel works on Windows for now.";
    if (!canWriteFiles()) return 'Turn on Edit > Preferences > Scripting & Expressions > "Allow Scripts to Write Files and Access Network", then try again.';
    if (!new File(CAPTURE).exists) return "remotion-ae was not found at " + REMOTION_AE + ". Reinstall the panel with npm run install-panel.";
    if (!dir) return "Choose the Remotion project folder (the folder with package.json).";
    if (!new File(dir + "/package.json").exists) return "That folder has no package.json; choose the Remotion project's main folder.";
    if (!new Folder(dir + "/node_modules/remotion").exists) {
      showInstall(true);
      return "This project's dependencies are not installed yet. Click the button below to install them (needs internet).";
    }
    showInstall(false);
    return null;
  }

  function listCompositions() {
    var dir = projectDir();
    var p = problems(dir);
    if (p) return say(p);
    saveSetting("projectDir", dir);
    compList.removeAll();
    startCapture([dir, "--list"], null, function (s) {
      if (s.state !== "done") return say("Could not read the project:\n" + s.error);
      var previous = setting("composition", "");
      for (var i = 0; i < s.compositions.length; i++) {
        var c = s.compositions[i];
        var item = compList.add("item", c.id);
        item.meta = c;
        if (c.id === previous || i === 0) compList.selection = item;
      }
      bar.value = 0;
      say(s.compositions.length ? s.compositions.length + " composition(s) found. Pick one and click Import." : "This project has no compositions.");
    });
  }

  // share of the progress bar per stage: opening 0-10, finding 10-40, measuring 40-70, artwork 70-95
  var STAGES = { opening: [0, 10], finding: [10, 30], measuring: [40, 30], artwork: [70, 25] };
  function weightOf(s) {
    var st = STAGES[s.stage] || [0, 0];
    return st[0] + (s.total ? (st[1] * s.done) / s.total : 0);
  }

  function importComposition() {
    var dir = projectDir();
    var p = problems(dir);
    if (p) return say(p);
    if (!compList.selection) return say("Pick a composition first (click Refresh if the list is empty).");
    var id = compList.selection.text;
    saveSetting("composition", id);
    saveSetting("quality", String(quality.selection.index));
    saveSetting("replace", String(replaceBox.value));
    var args = [dir, "--composition", id, "--scale", String(quality.selection.index + 1)];
    if (replaceBox.value) args.push("--replace");
    startCapture(args, weightOf, function (s) {
      if (s.state !== "done") return say("The import failed:\n" + s.error);
      bar.value = 97;
      say("Building " + s.result.layers + " layers in After Effects...");
      var summary;
      try {
        summary = $.evalFile(new File(s.result.jsx));
      } catch (e) {
        return say("Building in After Effects failed: " + e.toString() + " (line " + e.line + ")");
      }
      bar.value = 100;
      say(String(summary).split("\n")[0] + " in " + s.result.seconds + " s.\nFiles: " + new File(s.result.jsx).parent.fsName);
    });
  }

  browseButton.onClick = function () {
    var start = projectDir() ? new Folder(projectDir()) : Folder.myDocuments;
    var folder = start.selectDlg("Choose the Remotion project folder (the one with package.json)");
    if (!folder) return;
    projectText.text = folder.fsName;
    listCompositions();
  };
  refreshButton.onClick = listCompositions;
  importButton.onClick = importComposition;
  installButton.onClick = function () {
    startCommand("npm install", projectDir().replace(/\//g, "\\"), "Installing the project's dependencies (this can take a few minutes)...", function (s) {
      if (s.state !== "done") return say("npm install failed:\n" + s.error);
      showInstall(false);
      listCompositions();
    });
  };

  // expose the actions for automated tests (driven through remotion-ae's bridge)
  $.global.remotionAEPanel.ui = { projectText: projectText, compList: compList, quality: quality, replaceBox: replaceBox, statusText: statusText, bar: bar };
  $.global.remotionAEPanel.list = listCompositions;
  $.global.remotionAEPanel.importNow = importComposition;

  w.onResizing = w.onResize = function () {
    this.layout.resize();
  };
  if (w instanceof Window) {
    w.center();
    w.show();
  } else {
    w.layout.layout(true);
  }
  if (projectDir()) {
    var initial = problems(projectDir());
    if (initial) say(initial);
    else listCompositions();
  } else {
    say("Choose the Remotion project folder to start.");
  }
})(this);
