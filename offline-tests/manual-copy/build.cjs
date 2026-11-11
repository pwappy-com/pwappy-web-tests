'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');

module.exports = async function build(source, output) {
  const sourceRequire = createRequire(path.join(source, 'package.json'));
  const webpack = sourceRequire('webpack');
  await new Promise((resolve, reject) => {
    webpack({
      mode: 'development', context: source,
      entry: path.join(source, 'src/components/AgentChatWindow.js'),
      output: { path: output, filename: 'component.js', library: { name: 'AgentModule', type: 'window' } },
      devtool: false,
      resolve: { modules: [path.join(source, 'node_modules'), 'node_modules'], fallback: { fs: false, path: false, crypto: false } },
      module: { rules: [{ test: /\.css$/, type: 'asset/source' }, { test: /\.(ttf|png|svg)$/, type: 'asset/resource' }] },
      // Never load the application's webpack config or .env (which may contain live endpoints).
      plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({}) })],
    }, (error, stats) => {
      if (error) return reject(error);
      if (stats.hasErrors()) return reject(new Error(stats.toString({ all: false, errors: true })));
      resolve();
    });
  });
};
