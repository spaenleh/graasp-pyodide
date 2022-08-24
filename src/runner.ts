// runner
import { RunnerConfig } from "./types";

// TODO: implement
const sanitize = (code: string) => {
  return code;
};

const runPython = (config: RunnerConfig, callback: () => void) => {
  const { headerCode = "", footerCode = "", code, worker, fs: files } = config;

  worker.onTerminated = callback;

  // send all files in the fs to the worker
  Object.keys(files).forEach((path) => {
    worker.putFile(path, files[path] && files[path].content);
  });

  // concatenate code
  const fullCode = `${headerCode}\n${code}\n${footerCode}`;

  worker.run(fullCode);
};

export { sanitize, runPython };
