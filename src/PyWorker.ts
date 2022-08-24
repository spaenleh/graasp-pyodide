/*

Test of pyodide, with
	- stdout and stderr collected and displayed in a pre element
	- error message sent to stderr
	- last result displayed with sys.displayhook
	- dynamic loading of modules referenced by import statements
	- file support
	- runs asynchronously in a webworker, with timeout and interruption

Author: Yves Piguet, EPFL, 2019-2020

Usage:

let pyWorker = new PyWorker();
pyWorker.onStatusChanged = (statusString) => { ... };
pyWorker.onTerminated = () => { ... };
pyWorker.onOutput = (text) => { ... };
pyWorker.onInput = (prompt) => { ... };
pyWorker.onFigure = (imageDataURL) => { ... }
pyWorker.onTimeout = () => { ... };
pyWorker.onDirtyFile = (path) => { ... };
pyWorker.onFile = (path, data) => { ... };
pyWorker.addCommand("name", (data) => { ... });

pyWorker.preload();	// optional

pyWorker.run("...");
pyWorker.stop();

*/

class PyWorker {
  workerURL: string;
  worker: Worker | null;
  isRunning: boolean;
  // maximum allowed time to load packages in seconds
  maxTimeout: number;
  // id of the setTimeout function to cancel a running timeout
  timeoutId: number;
  // buffer for output
  outputBuffer: string;

  // callbacks
  onOutput: ((outputBuffer: string) => void) | null;
  onInput: ((prompt: string) => void) | null;
  onFigure: ((data: string) => void) | null;
  onTimeout: (() => void) | null;
  onDirtyFile: ((data: unknown) => void) | null;
  onFile: ((path: string, data: unknown) => void) | null;
  // called to announce a status change
  onStatusChanged: ((status: string) => void) | null;
  // called when the worker is done
  onTerminated: (() => void) | null;

  //  --- private arguments ---
  // Commands that can be used from the worker with 'sendCommand(name, data)'
  // and from python with 'import js; js.sendCommand(name, data)'
  private commands: { [key: string]: Function };
  private webworkerStatus: string;

  constructor(workerURL?: string) {
    this.workerURL = workerURL || "webWorker.js";
    this.worker = null;
    this.isRunning = false;
    this.maxTimeout = 180; // seconds (should be enough for numpy + scipy + matplotlib)
    this.timeoutId = -1;
    this.outputBuffer = "";

    // callbacks
    this.onOutput = null;
    this.onInput = null;
    this.onFigure = null;
    this.onTimeout = null;
    this.onDirtyFile = null;
    this.onFile = null;
    this.onStatusChanged = null;
    this.onTerminated = null;

    // commands added by addCommand(name, (data) => { ... })
    // (can be called from webworker with sendCommand;
    // from Python, with import js; js.sendCommand(name, data) )
    this.commands = {};
  }

  /**
   * Add a custom command that can be called from the WebWorker or from python:
   *
   * ```py
   * import js
   * js.sendCommand(name, data)
   * ```
   * @param name string identifier for the command
   * @param func callback function associated with the command
   */
  addCommand(name: string, func: Function) {
    this.commands[name] = func;
  }

  stop() {
    if (this.worker != null) {
      this.worker.terminate();
      this.worker = null;
      this.isRunning = false;
      this.onTerminated && this.onTerminated();
    }
  }

  create() {
    this.stop();
    this.worker = new Worker(this.workerURL);
    this.isRunning = false;
    this.worker.addEventListener("message", (ev) => {
      switch (ev.data.cmd) {
        case "print":
          this.printToOutput(ev.data.data);
          break;
        case "clear":
          this.clearOutput();
          break;
        case "figure":
          this.onFigure && this.onFigure(ev.data.data);
          break;
        case "dirty":
          this.onDirtyFile && this.onDirtyFile(ev.data.data);
          break;
        case "file":
          this.onFile && this.onFile(ev.data.path, ev.data.data);
          break;
        case "input":
          this.isRunning = false;
          this.onInput && this.onInput(ev.data.prompt);
          break;
        case "status":
          this.webworkerStatus = ev.data.status;
          this.onStatusChanged && this.onStatusChanged(this.webworkerStatus);
          break;
        case "done":
          this.isRunning = false;
          this.webworkerStatus = "";
          this.onStatusChanged && this.onStatusChanged("");
          this.onTerminated && this.onTerminated();
          break;
        default:
          if (
            ev.data.cmd.slice(0, 4) === "cmd:" &&
            this.commands[ev.data.cmd.slice(4)]
          ) {
            this.commands[ev.data.cmd.slice(4)](ev.data.data);
          }
          break;
      }
    });
    this.worker.addEventListener("error", (ev) => {
      console.info(ev);
    });
  }

  handleTimeout() {
    if (this.maxTimeout >= 0) {
      if (this.timeoutId >= 0) {
        clearTimeout(this.timeoutId);
      }
      this.timeoutId = setTimeout(() => {
        if (this.isRunning) {
          this.stop();
          this.onStatusChanged && this.onStatusChanged("");
          this.onTimeout && this.onTimeout();
          console.log("Timed out");
        }
        this.timeoutId = -1;
      }, 1000 * this.maxTimeout);
    }
  }

  run(src: string) {
    if (this.worker == null || this.isRunning) {
      this.create();
    }
    console.log("running");

    const msg = src != null ? { cmd: "run", code: src } : { cmd: "preload" };
    this.worker?.postMessage(JSON.stringify(msg));
    this.isRunning = true;
    this.handleTimeout();
  }

  /**
   * Send input to 'input()' function
   * @param str input of the user
   */
  submitInput(str: string) {
    if (this.worker && !this.isRunning) {
      const msg = { cmd: "submit", str: str };
      this.worker.postMessage(JSON.stringify(msg));
      this.isRunning = true;
      this.handleTimeout();
    }
  }

  /**
   * Cancel input request from python
   */
  cancelInput() {
    if (this.worker && !this.isRunning) {
      const msg = { cmd: "cancel" };
      this.worker.postMessage(JSON.stringify(msg));
    }
  }

  getFile(path: string) {
    const msg = { cmd: "get", path: path };
    this.worker?.postMessage(JSON.stringify(msg));
  }

  putFile(path: string, data: string) {
    const msg = { cmd: "put", path: path, data: data };
    this.worker?.postMessage(JSON.stringify(msg));
  }

  preload() {
    this.run(null);
  }

  clearOutput() {
    this.outputBuffer = "";
    this.onOutput && this.onOutput(this.outputBuffer);
  }

  clearFigure() {
    const msg = { cmd: "clearFigure" };
    this.worker?.postMessage(JSON.stringify(msg));
  }

  printToOutput(str: string) {
    this.outputBuffer += str;
    this.onOutput && this.onOutput(this.outputBuffer);
  }
}

export default PyWorker;
