const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");
const { DefinePlugin } = require("webpack");
const PwaPlugin = require("./scripts/pwa-plugin");

module.exports = (env = {}) => ({
  mode: "production",
  module: {
    rules: [
      {
        test: /\.csv/,
        type: "asset/resource",
      },
      {
        test: /\.json/,
        type: "asset/resource",
      },
      {
        test: /\.(png|svg|jpg|jpeg|gif|ico)$/i,
        type: "asset/resource",
      },
      {
        test: /\.css$/i,
        use: ["style-loader", "css-loader"],
      },
    ],
    strictExportPresence: true,
  },
  entry: {
    index: "./src/index.js",
    // The service worker is standalone: its own file name, and no shared
    // runtime chunk (it cannot load one).
    sw: { import: "./src/sw.js", filename: "sw.js", runtime: false },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: "./src/index.html",
      favicon: "./src/img/favicon.ico",
      title: "NPS Passport to your National Parks",
      excludeChunks: ["sw"],
    }),
    // Offline support: no worker under `webpack serve` (it would pin stale
    // builds). Playwright serves the built dist/, so it registers there.
    new DefinePlugin({
      "process.env.SERVICE_WORKER": JSON.stringify(!env.WEBPACK_SERVE),
    }),
    new PwaPlugin({
      worker: "sw.js",
      manifest: path.resolve(__dirname, "src/manifest.webmanifest"),
      icons: [
        path.resolve(__dirname, "src/img/icon-180.png"),
        path.resolve(__dirname, "src/img/icon.svg"),
      ],
    }),
  ],
  output: {
    filename: "[name].bundle.js",
    path: path.resolve(__dirname, "dist"),
  },
  optimization: {
    runtimeChunk: "single",
  },
  devServer: {
    compress: true,
    port: 9000,
  },
  stats: {
    logging: "info", //  errors, warnings, and info messages
    warnings: true,
  },
  performance: {
    // The large assets are the separately-fetched data JSON files, not the JS
    // entrypoints; raise both budgets so the dev server's HMR chunks don't
    // surface a misleading entrypoint-size warning.
    maxAssetSize: 2000000,
    maxEntrypointSize: 512000,
  },
});
