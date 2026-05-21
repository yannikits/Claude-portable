/**
 * Binding-Loader-Monkey-Patch fuer node-pty.
 *
 * Hintergrund: `@yao-pkg/pkg` (unser Sidecar-Bundler) baked das gesamte
 * `node_modules`-Tree in ein virtuelles snapshot-FS. Native `.node`-Files
 * funktionieren da nicht — sie muessen real-on-disk liegen. node-pty
 * resolved seine bindings via `lib/utils.js loadNativeModule()`, das
 * relativ zu `__dirname` in `build/Release/`, `build/Debug/` und
 * `prebuilds/<platform>-<arch>/` sucht. Im pkg-snapshot zeigen die alle
 * ins virtuelle FS und schlagen fehl.
 *
 * Workaround: vor dem ersten `require('node-pty')` patchen wir
 * `lib/utils.js loadNativeModule` so dass es zuerst aus
 * `process.env.CLAUDE_OS_PTY_BINDINGS_DIR` laedt (gesetzt vom Tauri-
 * Supervisor — siehe `gui/src-tauri/src/supervisor.rs`). Wenn die
 * env-Var nicht gesetzt ist oder der bindings-Pfad nicht passt,
 * fall back auf die originale relative-paths-Suche (dev-mode ohne
 * pkg-Bundle funktioniert dann weiterhin).
 *
 * Wird per Spike auf Windows 10 validiert: `npm install node-pty@1.1.0`
 * landet prebuilds in `node_modules/node-pty/prebuilds/<platform>-<arch>/`,
 * der monkey-patch findet sie aus dem sideloaded resource-dir.
 *
 * @module @sidecar/pty-binding-loader
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

const requireCjs = createRequire(import.meta.url);

interface PtyUtilsModule {
  loadNativeModule(name: string): { dir: string; module: unknown };
}

let patched = false;

/**
 * Idempotenter Monkey-Patch. Erster Aufruf modifiziert das exports-
 * Object von `node-pty/lib/utils.js`; alle weiteren Aufrufe sind No-Ops.
 * MUSS vor dem ersten `require('node-pty')` ablaufen, sonst koennten
 * andere node-pty-Module bereits `loadNativeModule` per closure
 * gecached haben.
 */
function applyMonkeyPatch(): void {
  if (patched) return;
  patched = true;

  const ptyUtils = requireCjs('node-pty/lib/utils.js') as PtyUtilsModule;
  const original = ptyUtils.loadNativeModule.bind(ptyUtils);

  ptyUtils.loadNativeModule = (name: string) => {
    const bindingsDir = process.env.CLAUDE_OS_PTY_BINDINGS_DIR;
    if (typeof bindingsDir === 'string' && bindingsDir.length > 0) {
      try {
        const fullPath = join(bindingsDir, `${name}.node`);
        return { dir: bindingsDir, module: requireCjs(fullPath) };
      } catch {
        // Fallthrough: original-lookup probieren — z. B. weil das
        // .node nicht ge-shipped wurde (dev) oder weil der CI-build
        // den prebuild nicht in den resource-dir kopiert hat.
      }
    }
    return original(name);
  };
}

/**
 * Idempotenter node-pty-Loader. Wendet den Monkey-Patch an (no-op nach
 * dem ersten Call) und liefert das `node-pty`-Module zurueck.
 */
export function loadNodePty(): typeof import('node-pty') {
  applyMonkeyPatch();
  return requireCjs('node-pty') as typeof import('node-pty');
}
