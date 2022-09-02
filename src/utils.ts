export const getWrappedWorkerCode = (url: string) => {
  return `importScripts("${url}");`;
};
