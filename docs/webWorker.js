// can not import the webworker code like this because of origin policies
/*

Test of pyodide, with
	- stdout and stderr collected and displayed in a pre element
	- error message sent to stderr
	- last result displayed with sys.displayhook
	- dynamic loading of modules referenced by import statements
	- runs asynchronously in a webworker, with timeout and interruption


Messages sent from main thread to webworker: json, {cmd:string,...}, with:
- cmd="config": options={sharedOutput:b}
- cmd="preload": load Pyodide to execute first "run" quicker
- cmd="run": code=Python source code to be executed
- cmd="submit": str=string provided by the user
- cmd="get": path=path of file to be sent back with {cmd:"file",data:content}
- cmd="put": path=path of file to be stored in fs, data=content
- cmd="clearFigure"

Messages sent from webworker to main thread: json, {cmd:string,...}, with:
- cmd="clear": clear output
- cmd="cmd:xxx": additional command with data sent by sendCommand
- cmd="done": sent once execution is completed
- cmd="dirty": data=path of file which has been modified
- cmd="figure": data=dataUrl
- cmd="file": path=string, data=string=file content, reply to cmd="get"
- cmd="input": prompt=string or null, expect a message back with cmd="submit"
- cmd="print": data=string to be appended to the output

Author: Yves Piguet, EPFL, 2019-2021

*/
const pyodideVersionURL = "https://cdn.jsdelivr.net/pyodide/v0.21.0/full/";

importScripts(
  "https://spaenleh.github.io/graasp-pyodide/Pyodide.js",
  `${pyodideVersionURL}pyodide.js`
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
      pyodideURL: pyodideURL,
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
