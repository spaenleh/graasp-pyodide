# Graasp Pyodide

[Pyodide](https://pyodide.org/en/stable/index.html) lets you run 🐍 Python code in the browser with [WebAssembly](https://webassembly.org/).
This package exposes an API to create a web worker that can execute python code.
You can use this package in your React App, or any other framework.

## Installation

Use the package manager of your choice (`npm` or `yarn`) and run:

```bash
yarn add @graasp/pyodide-worker
```

## Usage

```js
import { PyWorker } from "@graasp/pyodide-worker";

// create an instance of the PyWorker with the path to the worker code (is sensible to where this is being called)
let worker = new PyWorker("path/to/worker");

// specify the timeout in seconds before the worker is killed (default is 180s)
worker.maxTimeout = 60;

// add custom commands that can be called from the worker and from python with
// import js; js.sendCommand(name, data)
worker.addCommand("alert", (msg) => {
  alert(msg);
});

// set output callback
worker.onOutput = (text) => {
  // some logic here
};

// handle figures
worker.onFigure = (imageDataUrl) => {
  // some logic here
};

// handle dynamic user input
worker.onInput = (text) => {
  const res = console.prompt(text);
  if (res) {
    worker.submitInput(res);
  } else {
    worker.cancelInput();
  }
};

// when finished registering the callback removes the activity flag
worker.onTerminated = () => {
  console.log("Worker is done.");
};

worker.preload();

worker.run(
  `print("Hello World");import js; js.sendCommand("alert", "Hello");mood = input("How are you ?"); print(mood)`
);
```

## Contributing

Pull requests are welcome. Open an issue describing the feature or bug that you want to target with some related information.

## License

[AGPLv3](https://choosealicense.com/licenses/agpl-3.0/)

## Updating Pyodide version

2 files need to be updated in order to change the version of pyodide used: `webWorker.js` and `Pyodide-v0.2.0.js` where they set the url to fetch pyodide from.
