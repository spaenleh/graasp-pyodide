import { terser } from "rollup-plugin-terser";
// import resolve from "rollup-plugin-node-resolve";

export default [
  {
    input: ["src/fullWorker.js"],
    output: {
      // dir: "dist/",
      file: "dist/fullWorker.min.js",
      format: "esm",
    },
    plugins: [
      // resolve(),
      terser({
        warnings: true,
        mangle: {
          module: true,
        },
      }),
      // My custom "plugin" that wraps the built worker code into
      // a string that we can use with `new Blob()`
      // {
      //   name: "worker-to-string",
      //   renderChunk(code) {
      //     return "export default '" + code + "';";
      //   },
      // },
    ],
  },
  // ... other build stuff
];
