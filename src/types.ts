import PyWorker from "./PyWorker";

type File = {
  content: string;
};

export interface RunnerConfig {
  code: string;
  headerCode?: string;
  footerCode?: string;
  worker: PyWorker;
  // todo: rename to files
  fs: { [key: string]: File };
}
