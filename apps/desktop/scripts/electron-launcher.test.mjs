import { assert, describe, it } from "vite-plus/test";

import {
  makeDevelopmentLauncherSource,
  resolveElectronBinaryPath,
  resolveMacLauncherPaths,
} from "./electron-launcher.mjs";

describe("electron development launcher", () => {
  it("uses captured values only as fallbacks in a native launcher", () => {
    const source = makeDevelopmentLauncherSource({
      electronBinaryPath: "/repo/node_modules/electron/Electron",
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {
        VITE_DEV_SERVER_URL: "http://127.0.0.1:8526",
        T3CODE_PORT: "16566",
        T3CODE_HOME: "/tmp/t3",
      },
    });

    assert.include(source, 'set_fallback("VITE_DEV_SERVER_URL", "http://127.0.0.1:8526");');
    assert.notInclude(source, "#!/bin/sh");
    assert.include(
      source,
      'const char *desktop_root_arg = "--t3code-dev-root=/repo/apps/desktop";',
    );
    assert.include(
      source,
      'const char *main_entry_path = "/repo/apps/desktop/dist-electron/main.cjs";',
    );
    assert.include(source, "execv(electron_path, launch_argv);");
  });

  it("repairs Electron before loading the package entrypoint", () => {
    const calls = [];
    const electronPath = resolveElectronBinaryPath({
      ensureRuntime: () => {
        calls.push("ensure");
      },
      createRequire: () => (specifier) => {
        calls.push(`require:${specifier}`);
        return "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron";
      },
      moduleUrl: import.meta.url,
    });

    assert.equal(
      electronPath,
      "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
    );
    assert.deepEqual(calls, ["ensure", "require:electron"]);
  });

  it("keeps the native Electron executable name inside the branded macOS bundle", () => {
    const paths = resolveMacLauncherPaths(
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app",
      "T3 Code (Dev)",
    );

    assert.equal(paths.launcherExecutableName, "T3 Code (Dev) Launcher");
    assert.equal(
      paths.launcherBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/T3 Code (Dev) Launcher",
    );
    assert.equal(
      paths.runtimeElectronBinaryPath,
      "/repo/apps/desktop/.electron-runtime/T3 Code (Dev).app/Contents/MacOS/Electron",
    );

    const source = makeDevelopmentLauncherSource({
      electronBinaryPath: paths.runtimeElectronBinaryPath,
      mainEntryPath: "/repo/apps/desktop/dist-electron/main.cjs",
      desktopRoot: "/repo/apps/desktop",
      environment: {},
    });
    assert.include(source, `const char *electron_path = "${paths.runtimeElectronBinaryPath}";`);
    assert.notInclude(source, "#!/bin/sh");
  });
});
