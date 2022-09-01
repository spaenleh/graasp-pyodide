import { terser } from "rollup-plugin-terser";

export default [
  {
    input: ["src/fullWorker.js"],
    output: {
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
    ],
  },
];
