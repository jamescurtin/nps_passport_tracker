const path = require("path");
const HtmlWebpackPlugin = require("html-webpack-plugin");

module.exports = {
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
    index: {
      import: "./src/index.js",
      dependOn: "colorscale",
    },
    colorscale: {
      import: "./src/js/colorscale.js",
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      favicon: "./src/img/favicon.ico",
      title: "NPS Passport to your National Parks",
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
    maxAssetSize: 2000000,
  },
};
