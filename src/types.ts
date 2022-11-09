import PyWorker from "./PyWorker";

export type File = {
  content: string;
};

/** @enum {string} describes the status of the pyodide instance */
export enum PyodideStatus {
  READY = "Ready",
  RUNNING = "Running",
  LOADING_PYODIDE = "Loading Pyodide…",
  LOADING_MODULE = "Loading Modules…",
  PRE_LOADING_MODULE = "Pre-loading Modules…",
  PRE_LOADING_MODULE_ERROR = "Failed Pre-loading…",
  INSTALLING = "Installing…",
  WAIT_INPUT = "Waiting on input",
  ERROR = "Error",
  TIMEOUT = "Failed: Timeout",
  UNKNOWN_STATUS = "Unknown Status",
}

export interface RunnerConfig {
  code: string;
  headerCode?: string;
  footerCode?: string;
  worker: PyWorker;
  // todo: rename to files
  fs: { [key: string]: File };
}

export type { PyWorker };
