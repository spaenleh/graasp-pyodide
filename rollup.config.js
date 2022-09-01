import { terser } from "rollup-plugin-terser";

export default [
  {
    input: ["src/fullWorker.js"],
    output: {
      file: "docs/fullWorker.min.js",
      format: "esm",
    },
    plugins: [
      terser({
        warnings: true,
        mangle: {
          module: true,
        },
      }),
    ],
  },
];
