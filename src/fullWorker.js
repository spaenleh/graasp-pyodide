// UP-TO_DATE with pyodide-live

const pyodideVersionURL = "https://cdn.jsdelivr.net/pyodide/v0.21.0/full/";

/*

Test of pyodide, with
    - stdout and stderr collected and displayed in a pre element
    - error message sent to stderr
    - last result displayed with sys.displayhook
    - dynamic loading of modules referenced by import statements
    - file support
    - matplotlib support

Author: Yves Piguet, EPFL, 2019-2021

Usage:
    const options = {
        postExec: function () { /* executed when execution is finished ** },
        write: function (str) { /* write text output ** },
        clearText: function () { /* clear text output ** },
        setFigureURL: function (dataURL) { /* show graphical output ** },
        notifyDirtyFile: function (path) { /* notify that a file has been modified ** },
        handleInput: boolean /* see below **
    };
    const p = new Pyodide(options);
    p.load();   // optional arg: function called once everything is loaded
    p.run(src);
    ...
    let dirtyFilePaths = p.getDirtyFilePaths(reset);
    // fetch dirtyFilePaths in sessionStorage and save them, upon page unload
    // or periodically, typically with reset=true to mark saved files as clean

With option handleInput=true, some support for input function is provided.
It is limited to calls outside any function definition. The whole code is
compiled as a coroutine, replacing "input(...)" with "(yield(False,...,locals()))",
and the function is executed as a coroutine, sending input string (first
None) and receiving prompt for next input until a StopIteration exception
is raised. A last yield(True,None,locals()) is executed at the end to
assign variables changed after the last input(); True (=done) means that
the code has completed.
To enable it:
- pass handleInput:true in Pyodide constructor options
- after executing method p.run(src), check if p.requestInput is true; if it is,
get input from the user with prompt p.inputPrompt (null if None was passed to
Python "input" function), execute p.submitInput(input), and continue checking
p.requestInput and getting more input from the user until p.requestInput is false.
By default, input prompt is assumed to be displayed at a different place than in
standard output; both the prompt and the value entered by the user are echoed
to stdout once they have been submitted. By setting options.inlineInput=true,
the prompt is written to stdout before p.run returns with p.requestInput===true,
the value entered by the user is assumed to be echoed immediately to stdout
(e.g. in an emulated terminal), and to remain there; it is not echoed by Pyodide.

/** Simple virtual file system
*/
class VirtualFileSystem {
  /** Create a FileSystem object with data stored in sessionStorage
        @return {VirtualFileSystem}
    */
  static create() {
    return self.sessionStorage
      ? new FileSystemSessionStorage()
      : new FileSystemJS();
  }
}

/** Simple virtual file system with data stored internally
 */
class FileSystemJS extends VirtualFileSystem {
  constructor() {
    super();
    this.fs = {};
  }

  getDir() {
    return Object.keys(this.fs);
  }

  getFile(filename) {
    return this.fs[filename];
  }

  setFile(filename, content) {
    this.fs[filename] = content;
  }
}

/** Simple virtual file system with data stored as separate entries in
    sessionStorage
*/
class FileSystemSessionStorage extends VirtualFileSystem {
  getDir() {
    return Object.keys(self.sessionStorage);
  }

  getFile(filename) {
    return self.sessionStorage.getItem(filename);
  }

  setFile(filename, content) {
    self.sessionStorage.setItem(filename, content);
  }
}

class Pyodide {
  constructor(options) {
    this.pyodide = null;

    this.postExec = (options && options.postExec) || (() => {});
    this.write = (options && options.write) || ((str) => {});
    this.clearText = (options && options.clearText) || (() => {});
    this.setFigureURL = (options && options.setFigureURL) || ((url) => {});
    this.notifyDirtyFile =
      (options && options.notifyDirtyFile) || ((path) => {});
    this.notifyStatus = (options && options.notifyStatus) || ((status) => {});

    this.handleInput = (options && options.handleInput) || false;
    this.inlineInput = (options && options.inlineInput) || false;
    this.pyodideURL = (options && options.pyodideURL) || pyodideVersionURL;
    var versionRes = /\/(v[\d.]+)\//.exec(this.pyodideURL);
    this.pyodideVersion = versionRes ? versionRes[1] : "";
    this.requestInput = false;
    this.inputPrompt = null;
    this.suspended = false; // in debugger
    this.dbgCurrentLine = null;

    // modules requested to be pre-loaded
    this.preLoadedPackages = options?.preLoadedPackages;
    // requested modules waiting to be fetched
    this.requestedModuleNames = [];
    // requested modules which have been fetched successfully
    this.loadedModuleNames = [];
    // requested modules which could not be fetched successfully
    this.failedModuleNames = [];

    // virtual file system
    this.fs = VirtualFileSystem.create();
    // files which have been created or modified
    this.dirtyFiles = [];
  }

  load(then) {
    this.notifyStatus("loading Pyodide " + this.pyodideVersion);
    console.log("Using new syntax for worker");

    globalThis
      .loadPyodide({
        indexURL: this.pyodideURL,
      })
      .then((pyodide) => {
        this.pyodide = pyodide;
        this.pyodideVersion = pyodide.version;

        this.notifyStatus("setup");

        self.pyodideGlobal = {
          requestModule: (name) => this.requestModule(name),
          fs: this.fs,
          markFileDirty: (path) => this.markFileDirty(path),
          setDbgCurrentLine: (line) => {
            this.dbgCurrentLine = line;
          },
        };

        // pre-load requested packages
        this.preLoadedPackages.forEach((packageName) => {
          this.notifyStatus("pre-loading " + packageName);
          this.pyodide
            .loadPackage(packageName)
            .then(() => {
              this.loadedModuleNames.push(packageName);
            })
            .catch((err) => {
              this.failedModuleNames.push(packageName);
              this.notifyStatus("error pre-loading " + packageName + err);
            });
        });

        this.pyodide.runPython(`
                import sys
                import io
                from js import pyodideGlobal

                class __ImportIntercept:
                    def find_spec(self, name, path, module):
                        pyodideGlobal.requestModule(name)
                sys.meta_path.append(__ImportIntercept())

                class MyTextFile(io.StringIO):
                    def __init__(self, filename, mode="r"):
                        self.filename = filename
                        self.readOnly = mode == "r"
                        content = pyodideGlobal.fs.getFile(filename)
                        if content is None:
                            if self.readOnly:
                                raise FileNotFoundError(filename)
                            content = ""
                        else:
                            if mode == "w":
                                content = ""
                            elif mode == "x":
                                raise FileExistsError(filename)
                        super().__init__(content if content is not None else "")
                        if mode == "a":
                            self.seek(0, 2)
                    def close(self):
                        if not self.readOnly:
                            content = self.getvalue()
                            pyodideGlobal.fs.setFile(self.filename, content)
                            pyodideGlobal.markFileDirty(self.filename)
                            super().close()

                def open(filename, mode="r", encoding=None):
                    return MyTextFile(filename, mode)

                import os

                def __os_listdir(path="."):
                    return list(pyodideGlobal.fs.getDir())
                os.listdir = __os_listdir

                # user code execution
                global_variables = {
                    "open": open,
                    "input": input
                }

                # global debugger
                dbg = None

                def execute_code(src, breakpoints=None):
                    """Return 0 if done, 1 if suspended in debugger, 2 if waiting for input"""

                    class Dbg:

                        import sys
                        import os
                        import re

                        class Suspended(Exception):
                            pass

                        class SuspendedForInput(Suspended):
                            pass

                        def __init__(self, interactive=True):
                            self.interactive = interactive
                            self.frame = None

                            # breakpoint line numbers
                            self.breakpoints = set()
                            self.break_at_start = True
                            # past actions or inputs from the user
                            # ("c"=continue, "n"=next, "s"=step, "r"=return, etc.)
                            # resume will execute them and suspend execution when they are exhausted
                            self.debug_action_history = []
                            # True to ignore trace calls until 2nd event="call"
                            self.ignore_top_call = False
                            # substitution for input global function
                            self.input_debug = None

                            self.last_command = ""

                            self.init_output()
                            self.null = open(self.os.devnull, "w")

                        def init_output(self):
                            self.stdout = self.sys.stdout
                            self.stderr = self.sys.stderr

                        def enable_print(self, on):
                            self.sys.stdout = self.stdout if on else self.null
                            self.sys.stderr = self.stderr if on else self.null

                        def clear_breakspoints(self):
                            self.breakpoints = set()

                        def set_breakpoint(self, lineno):
                            self.breakpoints.add(lineno)

                        def clear_breakspoint(self, lineno):
                            self.breakpoints.remove(lineno)

                        def is_suspended(self):
                            return self.frame is not None

                        def is_requesting_input(self):
                            return self.request_input

                        def debug_(self, fun, ignore_top_call, args, kwargs):
                            self.fun = fun
                            self.args = args
                            self.kwargs = kwargs
                            self.ignore_top_call = ignore_top_call
                            self.returned_value = None
                            self.debug_action_history = []
                            self.resume(None)
                            if self.interactive:
                                self.cli()

                        def debug_call(self, fun, *args, **kwargs):
                            self.debug_(fun, False, args, kwargs)

                        def debug_code(self, code, globals=globals(), locals=None):
                            def input(prompt):
                                return self.input_debug(prompt)
                            globals["input"] = input
                            self.debug_(lambda: exec(code, globals, locals), True, (), {})

                        def resume(self, cmd):
                            if cmd is not None:
                                self.debug_action_history.append(cmd)

                            # state ("s"=step, "n"=next, "r"=return, "c"=continue)
                            state = "s" if self.break_at_start else "c"
                            # index of first action in self.debug_action_history to perform
                            action_count = 0
                            # call depth used for "n" and "r"
                            call_depth = 0
                            last_break_depth = 0
                            # number of event "call"
                            call_count = 0

                            def trace(frame, event, arg):
                                nonlocal state, action_count, call_depth, last_break_depth, call_count
                                if self.ignore_top_call:
                                    if event == "call":
                                        if frame.f_code.co_name == "input":
                                            if action_count >= len(self.debug_action_history):
                                                # call to input(prompt): display prompt and request user input
                                                if frame.f_locals["prompt"] is not None:
                                                    self.sys.stdout.write(frame.f_locals["prompt"])
                                                self.frame = frame
                                                raise self.SuspendedForInput()
                                            else:
                                                # execute input() defined below (picks input in self.debug_action_history)
                                                pass
                                        call_count += 1
                                        call_depth += 1
                                    if call_count < 2:
                                        return
                                if event == "line":
                                    self.current_line = frame.f_lineno
                                    if (state == "n" and call_depth <= last_break_depth or
                                        state == "r" and call_depth < last_break_depth or
                                        state == "s" or
                                        frame.f_lineno in self.breakpoints):
                                        # breakpoint (explicit, or following s/n/r which should break here)
                                        if action_count >= len(self.debug_action_history):
                                            # not reached yet: really break here
                                            self.frame = frame
                                            raise self.Suspended()
                                        else:
                                            # already reached: continue
                                            state = self.debug_action_history[action_count]
                                            action_count += 1
                                            last_break_depth = call_depth
                                            if action_count >= len(self.debug_action_history):
                                                self.enable_print(True)
                                    elif action_count >= len(self.debug_action_history):
                                        self.enable_print(True)
                                elif event == "call":
                                    call_depth += 1
                                elif event == "return":
                                    call_depth -= 1
                                return trace

                            def input(prompt):
                                nonlocal action_count
                                str = self.debug_action_history[action_count]
                                action_count += 1
                                return str
                            self.input_debug = input

                            suspended = False
                            self.request_input = False
                            self.enable_print(len(self.debug_action_history) <= 1)
                            self.sys.settrace(trace)
                            try:
                                self.returned_value = self.fun(*self.args, **self.kwargs)
                            except self.SuspendedForInput:
                                suspended = True
                                self.request_input = True
                            except self.Suspended:
                                suspended = True
                            finally:
                                self.sys.settrace(None)
                                self.enable_print(True)
                            if not suspended:
                                self.frame = None

                        def eval_code(self, src):
                            try:
                                code = compile(src, "<stdin>", "single")
                                exec(code,
                                     self.frame.f_globals,
                                     self.frame.f_locals)
                            except Exception as e:
                                import traceback
                                traceback.print_exception(etype=type(e),
                                                          value=e,
                                                          tb=e.__traceback__)

                        def exec_cmd(self, cmd):
                            cmd = cmd.strip() or self.last_command
                            r = self.re.compile(r"^(\S+)(\s+(\S+))$")
                            match = r.match(cmd)
                            if match:
                                cmd0 = match.groups()[0]
                                arg = match.groups()[2]
                            else:
                                cmd0 = cmd
                                arg = None
                            if cmd0 in ["b", "break"]:
                                if arg is None:
                                    print(self.breakpoints)
                                else:
                                    try:
                                        lineno = int(arg)
                                        self.set_breakpoint(lineno)
                                    except:
                                        print("Bad line number")
                                self.last_command = ""
                            elif cmd in ["c", "continue"]:
                                self.resume("c")
                                self.last_command = cmd
                            elif cmd0 in ["cl", "clear"]:
                                if arg:
                                    try:
                                        lineno = int(arg)
                                        self.clear_breakspoint(lineno)
                                    except:
                                        print("Bad line number")
                                else:
                                    self.clear_breakspoints()
                                self.last_command = ""
                            elif cmd in ["h", "help"]:
                                import textwrap
                                print(textwrap.dedent("""
                                    b(reak) line  break at specified line
                                    c(ontinue)    continue
                                    cl(ear)       clear all breakpoints
                                    h(elp)        help
                                    q(quit)       quit
                                    r(eturn)      continue until the current function returns
                                    s(tep)        step
                                    w(here)       display a stack trace
                                    expr          evaluate expression, including local and global variables
                                    """))
                                self.last_command = ""
                            elif cmd in ["q", "quit"]:
                                self.frame = None
                            elif cmd in ["n", "next"]:
                                self.resume("n")
                                self.last_command = cmd
                            elif cmd in ["r", "return"]:
                                self.resume("r")
                                self.last_command = cmd
                            elif cmd in ["s", "step"]:
                                self.resume("s")
                                self.last_command = cmd
                            elif cmd in ["w", "where"]:
                                frame = self.frame
                                while frame and (frame.f_code.co_name != "resume"):
                                    print(f"{frame.f_code.co_name} at line {frame.f_lineno}")
                                    frame = frame.f_back
                            elif cmd != "":
                                self.eval_code(cmd)

                            # return true when execution is completed
                            return self.frame is None

                        def submit_input(self, input):
                            self.debug_action_history.append(input)
                            self.resume(None)

                        def cli(self):
                            while self.is_suspended():
                                cmd = input(f"{self.frame.f_code.co_name}:{self.frame.f_lineno} dbg> ")
                                self.exec_cmd(cmd)

                    try:
                        code = compile(src, "<stdin>", mode="single")
                    except SyntaxError:
                        code = compile(src, "<stdin>", mode="exec")

                    if breakpoints:
                        global dbg
                        dbg = Dbg(False)
                        dbg.break_at_start = False;
                        for breakpoint in breakpoints:
                            dbg.set_breakpoint(breakpoint)
                        dbg.debug_code(code, globals=global_variables)
                        return 0 if not dbg.is_suspended() else 2 if dbg.request_input else 1
                    else:
                        exec(code, global_variables)
                        return 0

                def continue_debugging(dbg_command):
                    if dbg is not None and dbg.is_suspended():
                        dbg.init_output()  # can be a new io.StringIO() object
                        dbg.exec_cmd(dbg_command)
                        return 0 if not dbg.is_suspended() else 2 if dbg.request_input else 1

                def submit_input_to_debugger(input):
                    if dbg is not None and dbg.is_suspended() and dbg.request_input:
                        dbg.init_output()  # can be a new io.StringIO() object
                        dbg.submit_input(input)
                        return 0 if not dbg.is_suspended() else 2 if dbg.request_input else 1

                def debug_current_line():
                    return dbg.current_line if dbg and dbg.is_suspended() else None
            `);

        then && then();
      });
  }

  requestModule(name) {
    if (
      this.requestedModuleNames.indexOf(name) < 0 &&
      this.loadedModuleNames.indexOf(name) < 0 &&
      this.failedModuleNames.indexOf(name) < 0
    ) {
      this.requestedModuleNames.push(name);
    }
  }

  markFileDirty(path) {
    if (this.dirtyFiles.indexOf(path) < 0) {
      this.dirtyFiles.push(path);
      this.notifyDirtyFile(path);
    }
  }

  getDirtyFilePaths(reset) {
    let dirtyFiles = this.dirtyFiles;
    if (reset) {
      this.dirtyFiles = [];
    }
    return dirtyFiles;
  }

  run(src, breakpoints) {
    // nothing to do if empty
    if (src.trim() === "") {
      return true;
    }

    // (re)set stdout and stderr
    this.pyodide.runPython(`
            import io, sys
            sys.stdout = io.StringIO()
            sys.stderr = sys.stdout
        `);

    // disable MatPlotLib output (will get it with matplotlib.pyplot.savefig)
    if (this.loadedModuleNames.indexOf("matplotlib") >= 0) {
      this.pyodide.runPython(`
                import matplotlib
                matplotlib.use("Agg")
            `);
    }

    if (this.handleInput) {
      this.pyodide.runPython(`
                class CodeWithInputEvaluator:

                    def __init__(self, src, global_variables):

                        import ast

                        def check_node(node, block_reason=None):
                            """Check that input function is called only from where it is supported,
                            i.e. at top-level if block_reason is None, not in functions or methods, and
                            nowhere if block_reason is a string describing the offending context. Raise
                            an exception otherwise.
                            """
                            if type(node) is ast.ClassDef:
                                block_reason = "class"
                            elif type(node) is ast.FunctionDef:
                                block_reason = "def"
                            elif type(node) is ast.Lambda:
                                block_reason = "lambda"
                            elif block_reason and type(node) is ast.Call and type(node.func) is ast.Name and node.func.id == "input":
                                raise Exception(f"input call not supported in {block_reason} at line {node.lineno}")
                            for child in ast.iter_child_nodes(node):
                                check_node(child, block_reason)

                        def check(src):
                            """Check that input function is called only from where it is supported,
                            i.e. at top-level, not in functions or methods. Raise an exception otherwise.
                            """
                            root = ast.parse(src)
                            check_node(root)

                        def replace_input_with_yield(src, function_name, global_var_names=[]):

                            """Compile source code and replace input calls with yield.
                            """
                            class Replacer(ast.NodeTransformer):
                                """NodeTransformer which replaces input(prompt) with
                                yield((False,prompt,locals()))
                                """
                                def visit_Call(self, node):
                                    self.generic_visit(node)
                                    if type(node.func) is ast.Name and node.func.id == "input":
                                        input_arg = node.args[0] if len(node.args) > 0 else ast.NameConstant(value=None)
                                        y = ast.Yield(value=ast.Tuple(
                                            elts=[
                                                ast.NameConstant(value=False),
                                                input_arg,
                                                ast.Call(func=ast.Name(id="locals", ctx=ast.Load()), args=[], keywords=[])
                                            ],
                                            ctx=ast.Load()
                                        ))
                                        return y
                                    return node

                            # compile to ast
                            root = ast.parse(src)

                            # check that input is called only from top-level code, not functions
                            check_node(root)

                            # replace input(prompt) with yield (False,prompt,locals())
                            replacer = Replacer()
                            root1 = replacer.visit(root)

                            # replace last statement with "import sys; sys.displayhook(expr)" if it is an expr
                            last_el = root1.body[-1]
                            if type(last_el) is ast.Expr:
                                expr = root1.body.pop()
                                root1.body.append(ast.Import(
                                    names=[
                                        ast.alias(name="sys", asname=None)
                                    ]
                                ))
                                root1.body.append(ast.Expr(
                                    value=ast.Call(
                                        func=ast.Attribute(attr="displayhook", value=ast.Name(id="sys", ctx=ast.Load()), ctx=ast.Load()),
                                        args=[expr.value],
                                        keywords=[]
                                    )
                                ))

                            # append yield (True,None,locals())
                            y = ast.Expr(
                                value=ast.Yield(value=ast.Tuple(
                                    elts=[
                                        ast.NameConstant(value=True),
                                        ast.NameConstant(value=None),
                                        ast.Call(func=ast.Name(id="locals", ctx=ast.Load()), args=[], keywords=[])
                                    ],
                                    ctx=ast.Load()
                                ))
                            )
                            root1.body.append(y)

                            # define a coroutine
                            root1.body = [
                                ast.FunctionDef(
                                    name=function_name,
                                    args=ast.arguments(
                                        posonlyargs=[],
                                        args=[ast.arg(arg=g, annotation=None) for g in global_var_names],
                                        defaults=[],
                                        kwarg=None,
                                        kw_defaults=[],
                                        kwonlyargs=[],
                                        vararg=None
                                    ),
                                    body=root1.body,
                                    decorator_list=[],
                                    returns=None
                                )
                            ]

                            # add dummy missing lineno and col_offset to make compiler happy
                            for node in ast.walk(root1):
                                if not hasattr(node, "lineno"):
                                    node.lineno = 1
                                if not hasattr(node, "col_offset"):
                                    node.col_offset = 999

                            # compile
                            code = compile(root1, "<ast>", "exec")

                            return code

                        def run_code_with_input_as_coroutine(src, global_variables):
                            code = replace_input_with_yield(src, "corout", global_variables)
                            gl = {}
                            exec(code, gl)
                            co = gl["corout"](**global_variables)
                            return co

                        self.global_variables = global_variables
                        self.co = run_code_with_input_as_coroutine(src, global_variables)
                        self.done, self.prompt, new_global_variables = self.co.send(None)
                        self.global_variables.update(new_global_variables)

                    def submit_input(self, input):
                        self.done, self.prompt, new_global_variables = self.co.send(input)
                        self.global_variables.update(new_global_variables)

                    def cancel_input(self):
                        self.co.close()
            `);
    }

    // run src until all requested modules have been loaded (or failed)
    let errMsg = "";
    this.requestedModuleNames = [];
    this.suspended = false;
    this.dbgCurrentLine = null;
    try {
      this.notifyStatus("running");
      self.pyodideGlobal.setFigureURL = (url) => this.setFigureURL(url);
      this.pyodide.globals.set("src", src);
      // there are breakpoints in the code
      if (breakpoints && breakpoints.length > 0) {
        const bpList =
          "[" + breakpoints.map((bp) => bp.toString(10)).join(", ") + "]";
        this.pyodide.runPython(`
                    import js
                    status = execute_code(src, breakpoints=${bpList})
                    suspended = status != 0
                    done = not suspended
                    js.pyodideGlobal.setDbgCurrentLine(debug_current_line())
                `);
        this.suspended = this.pyodide.globals.get("suspended");
        this.requestInput = this.pyodide.globals.get("status") === 2;
        this.inputPrompt = null;
      } else if (this.handleInput) {
        // convert src to a coroutine
        this.pyodide.runPython(
          "evaluator = CodeWithInputEvaluator(src, global_variables)"
        );
        this.requestInput = false;
        this.pyodide.runPython(`
                    done = evaluator.done
                    suspended = False
                    # suspended = evaluator.suspended
                    input_prompt = evaluator.prompt
                `);
        if (
          !this.pyodide.globals.get("done") &&
          !this.pyodide.globals.get("suspended")
        ) {
          this.inputPrompt = this.pyodide.globals.get("input_prompt");
          this.requestInput = true;
        }
      } else {
        this.pyodide.runPython(
          "execute_code(src); done = True; suspended = False"
        );
      }

      if (this.loadedModuleNames.indexOf("matplotlib") >= 0) {
        this.pyodide.runPython(`
                    import matplotlib.pyplot, io, base64, js
                    if matplotlib.pyplot.get_fignums():
                        with io.BytesIO() as buf:
                            matplotlib.pyplot.savefig(buf, format="png")
                            buf.seek(0)
                            js.pyodideGlobal.setFigureURL("data:image/png;base64," +
                                base64.b64encode(buf.read()).decode("ascii"))
                `);
      }
    } catch (err) {
      if (
        /ModuleNotFoundError/.test(err.message) &&
        this.requestedModuleNames.length > 0
      ) {
        const nextModuleName = this.requestedModuleNames.shift();
        this.notifyStatus("loading module " + nextModuleName);
        this.pyodide
          .loadPackage(nextModuleName)
          .then(() => {
            this.loadedModuleNames.push(nextModuleName);
            this.notifyStatus("running");
            this.run(src);
          })
          .catch(() => {
            this.failedModuleNames.push(nextModuleName);
            this.postExec && this.postExec();
          });
        // skip output and ui changes performed upon end
        // since we are not finished yet
        return false;
      } else {
        errMsg = err.message;
        this.pyodide.globals.set("done", true);
      }
    }

    let stdout = this.pyodide.runPython("sys.stdout.getvalue()");
    this.write(stdout + errMsg);

    if (
      !this.pyodide.globals.get("done") &&
      !this.pyodide.globals.get("suspended") &&
      this.inlineInput
    ) {
      // write prompt to stdout
      this.write(this.inputPrompt == undefined ? "? " : this.inputPrompt);
    }

    this.postExec && this.postExec();

    return true;
  }

  submitInput(str) {
    if (this.requestInput) {
      // (re)set stdout and stderr
      this.pyodide.runPython(`
                import io, sys
                sys.stdout = io.StringIO()
                sys.stderr = sys.stdout
            `);

      if (!this.inlineInput) {
        // write prompt and input to stdout
        this.write(
          (this.inputPrompt == undefined ? "? " : this.inputPrompt) + str + "\n"
        );
      }

      this.requestInput = false;
      self.input_string = str;
      let errMsg = "";
      if (this.suspended) {
        // submit input to debugger
        try {
          this.pyodide.runPython(`
                        import js
                        status = submit_input_to_debugger(js.input_string)
                        suspended = status != 0
                        done = not suspended
                        js.pyodideGlobal.setDbgCurrentLine(debug_current_line())
                    `);
          this.suspended = this.pyodide.globals.get("suspended");
          this.requestInput = this.pyodide.globals.get("status") == 2;
          this.inputPrompt = null;
        } catch (err) {}
      } else {
        // submit input using evaluator (coroutine)
        try {
          this.pyodide.runPython(`
                        import js
                        evaluator.submit_input(js.input_string)
                        done = evaluator.done
                        # suspended = evaluator.suspended
                        input_prompt = evaluator.prompt
                    `);
          if (
            !this.pyodide.globals.get("done") &&
            !this.pyodide.globals.get("suspended")
          ) {
            this.inputPrompt = this.pyodide.globals.get("input_prompt");
            this.requestInput = true;
          }
        } catch (err) {
          errMsg = err.message;
          this.pyodide.globals.set("done", true);
        }
      }

      let stdout = this.pyodide.runPython("sys.stdout.getvalue()");
      this.write(stdout + errMsg);

      if (
        !this.pyodide.globals.get("done") &&
        !this.pyodide.globals.get("suspended") &&
        this.inlineInput
      ) {
        // write prompt to stdout
        this.write(this.inputPrompt == undefined ? "? " : this.inputPrompt);
      }

      this.postExec && this.postExec();
    }
  }

  cancelInput() {
    if (this.requestInput) {
      this.requestInput = false;
      try {
        this.pyodide.runPython("evaluator.cancel_input()");
      } catch (err) {}
      this.dbgCurrentLine = null;
    }
  }

  continueDebugging(dbgCommand) {
    const resetCode =
      "import io, sys" +
      "sys.stdout = io.StringIO()" +
      "sys.stderr = sys.stdout";
    // (re)set stdout and stderr
    this.pyodide.runPython(resetCode);

    try {
      self.dbg_command = dbgCommand;
      this.pyodide.runPython(`
                import js
                status = continue_debugging(js.dbg_command)
                suspended = status != 0
                done = not suspended
                js.pyodideGlobal.setDbgCurrentLine(debug_current_line())
            `);
      this.suspended = this.pyodide.globals.get("suspended");
      this.requestInput = this.pyodide.globals.get("status") == 2;
      this.inputPrompt = null;
    } catch (err) {}

    let stdout = this.pyodide.runPython("sys.stdout.getvalue()");
    this.write(stdout);

    if (
      !this.pyodide.globals.get("done") &&
      !this.pyodide.globals.get("suspended") &&
      this.inlineInput
    ) {
      // write prompt to stdout
      this.write(this.inputPrompt == undefined ? "? " : this.inputPrompt);
    }

    this.postExec && this.postExec();
  }

  clearFigure() {
    if (this.loadedModuleNames.indexOf("matplotlib") >= 0) {
      this.pyodide.runPython(`
                import matplotlib.pyplot
                matplotlib.pyplot.close()
            `);
      const transp1by1 =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
      this.setFigureURL(transp1by1);
    }
  }

  clear() {
    this.clearText();
    this.clearFigure();
  }
}

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

importScripts(`${pyodideVersionURL}pyodide.js`);

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
      preLoadedPackages: configOptions?.preLoadedPackages || [],
      pyodideURL: pyodideVersionURL,
    };
    console.log("options inside worker: ", options);
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
