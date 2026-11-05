// Webpack plugin for offline support. After minification it
// - emits the icons and manifest.webmanifest at stable names at the root;
// - fills the two placeholders in sw.js: the precache list (every emitted
//   file except the worker itself) and a cache version (a hash of the file
//   contents, so the cache name changes exactly when the build does).
// Asset names are hashed, so the list cannot be written by hand.

const crypto = require("crypto");
const path = require("path");
const { Compilation, sources } = require("webpack");

const NAME = "PwaPlugin";
const SKIP = /\.(?:map|txt)$/;

class PwaPlugin {
  /**
   * @param {object} options
   * @param {string} options.worker - Emitted worker file name
   * @param {string} options.manifest - Source manifest path
   * @param {string[]} options.icons - Icon source paths to emit at the root
   */
  constructor({ worker, manifest, icons }) {
    this.worker = worker;
    this.manifest = manifest;
    this.icons = icons;
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap(NAME, (compilation) => {
      compilation.hooks.processAssets.tapPromise(
        { name: NAME, stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE },
        async () => {
          const fs = compiler.inputFileSystem;
          const read = (file) =>
            new Promise((resolve, reject) =>
              fs.readFile(file, (error, buffer) =>
                error ? reject(error) : resolve(buffer),
              ),
            );
          const emit = (name, content) => {
            if (!compilation.getAsset(name)) {
              compilation.emitAsset(name, new sources.RawSource(content));
            }
          };
          for (const icon of this.icons) {
            emit(path.basename(icon), await read(icon));
          }
          emit(path.basename(this.manifest), await read(this.manifest));

          const files = compilation
            .getAssets()
            .filter(({ name }) => name !== this.worker && !SKIP.test(name))
            .sort((a, b) => a.name.localeCompare(b.name));
          const hash = crypto.createHash("sha256");
          for (const { name, source } of files) {
            hash.update(name).update(source.buffer());
          }
          const version = hash.digest("hex").slice(0, 12);

          const worker = compilation.getAsset(this.worker);
          if (!worker) {
            compilation.errors.push(
              new Error(`${NAME}: ${this.worker} was not emitted`),
            );
            return;
          }
          let code = worker.source.source().toString();
          const list = JSON.stringify(files.map(({ name }) => name));
          // The list is a whole string literal. The version may be inlined
          // by the minifier into a longer string, so replace it bare.
          const patterns = [
            [/(["'`])__PRECACHE_LIST__\1/g, list],
            [/__CACHE_VERSION__/g, version],
          ];
          for (const [pattern, value] of patterns) {
            if (!pattern.test(code)) {
              compilation.errors.push(
                new Error(`${NAME}: placeholder ${pattern} not found`),
              );
              return;
            }
            pattern.lastIndex = 0;
            code = code.replace(pattern, () => value);
          }
          compilation.updateAsset(this.worker, new sources.RawSource(code));
        },
      );
    });
  }
}

module.exports = PwaPlugin;
