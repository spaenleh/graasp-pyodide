const pyodideVersionURL = "https://cdn.jsdelivr.net/pyodide/v0.21.0/full/";
// todo: modify this
const pyodideClassURL = "https://spaenleh.github.io/graasp-pyodide/";

export const getPythonWorkerCode = () => {
  return encodeURIComponent(`
importScripts(
  "${pyodideClassURL}Pyodide.js",
  "${pyodideVersionURL}pyodide.js"
);

var loaded = false;
let outputClear = false;
let outputBuffer = "";
let pendingOutputFlushTime = -1;
const outputUpdateRate = 10; // ms

var p = null;

function updateOutput(forced) {
  let currentTime = Date.now();
  if (forced) {
    pendingOutputFlushTime = currentTime;
  }
  if (pendingOutputFlushTime < 0) {
    // schedule flush
    pendingOutputFlushTime = currentTime + outputUpdateRate;
  } else if (pendingOutputFlushTime <= currentTime) {
    // time to flush
    if (outputClear) {
      postMessage({ cmd: "clear" });
      outputClear = false;
    }
    if (outputBuffer) {
      postMessage({ cmd: "print", data: outputBuffer });
      outputBuffer = "";
    }
    pendingOutputFlushTime = -1;
  }
}

function sendCommand(cmd, data) {
  postMessage({ cmd: "cmd:" + cmd, data: data });
}

function run(src, breakpoints) {
  postMessage({
    cmd: "status",
    status: breakpoints && breakpoints.length > 0 ? "debugging" : "running",
  });
  p.run(src, breakpoints);
}

function submitInput(str, breakpoints) {
  p.submitInput(str, breakpoints);
}

function cancelInput(str) {
  p.cancelInput();
}

onmessage = (ev) => {
  function init(configOptions) {
    const options = {
      write: (str) => {
        outputBuffer += str;
      },
      clearText: () => {
        outputBuffer = "";
        outputClear = true;
      },
      setFigureURL: (dataURL) => {
        postMessage({ cmd: "figure", data: dataURL });
      },
      notifyStatus: (status) => {
        postMessage({ cmd: "status", status: status });
      },
      notifyDirtyFile: (path) => {
        postMessage({ cmd: "dirty", data: path });
      },
      postExec: function () {
        updateOutput(true);
        postMessage({
          cmd: "done",
          suspendedAt: p.suspended ? p.dbgCurrentLine : null,
        });
        if (p.requestInput) {
          postMessage({ cmd: "input", prompt: p.inputPrompt });
        }
      },
      handleInput: (configOptions && configOptions.handleInput) || false,
      inlineInput: (configOptions && configOptions.inlineInput) || false,
      pyodideURL: "${pyodideVersionURL}",
    };
    p = new Pyodide(options);
  }

  let msg = JSON.parse(ev.data);

  if (msg.cmd === "config") {
    init(msg.options);
  } else {
    if (p == null) {
      init();
    }
    switch (msg.cmd) {
      case "preload":
        postMessage({ cmd: "status", status: "startup" });
        p.load(() => {
          loaded = true;
          postMessage({ cmd: "done" });
        });
        break;
      case "run":
        if (loaded) {
          run(msg.code, msg.breakpoints);
        } else {
          postMessage({ cmd: "status", status: "startup" });
          p.load(() => {
            run(msg.code, msg.breakpoints);
            loaded = true;
          });
        }
        break;
      case "submit":
        submitInput(msg.str);
        break;
      case "cancel":
        cancelInput();
        break;
      case "debug":
        if (loaded && p.suspended) {
          switch (msg.dbg) {
            case "next":
            case "step":
            case "return":
            case "continue":
            case "quit":
              p.continueDebugging(msg.dbg);
              break;
          }
        } else {
          postMessage({ cmd: "done" });
        }
        break;
      case "get":
        postMessage({
          cmd: "file",
          path: msg.path,
          data: p.fs.getFile(msg.path),
        });
        break;
      case "put":
        p.fs.setFile(msg.path, msg.data);
        break;
      case "clearFigure":
        p.clearFigure();
        break;
    }
  }
};
`);
};
