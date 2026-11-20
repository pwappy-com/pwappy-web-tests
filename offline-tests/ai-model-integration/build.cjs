const path = require('node:path');
const fs = require('node:fs');
const web = process.env.PWAPPY_WEB_CHECKOUT;
const output = process.env.PWAPPY_LOCAL_WEB_DIST;
if (!web || !output) throw new Error('Set PWAPPY_WEB_CHECKOUT and PWAPPY_LOCAL_WEB_DIST');
const deps = path.resolve(process.env.PWAPPY_WEB_NODE_MODULES || path.join(web, 'node_modules'));
const webpack = require(path.join(deps, 'webpack'));
const env = {
  ENDPOINT_BASE: '/rest/', LOGIN_COOKIE_NAME: 'pwappy_login',
  AI_CODE_ENDPOINT: 'v1/ai-script-coding', AI_AGENT_MESSAGE: 'v1/ai-agent',
  AI_AGENT_STATUS: 'v1/ai-agent-status', AI_AGENT_CANCEL: 'v1/ai-agent-cancel',
  POINTS_ENDPOINT: 'v1/pwappy-points', POINTS_ENDPOINT_HISTORY: 'v1/point-history',
};
webpack({
  mode: 'development', devtool: false, entry: path.join(__dirname, 'components.js'),
  output: {path: path.resolve(output), filename: 'components.js'},
  resolve: { alias: {'@pwappy-web': path.resolve(web, 'src')}, modules: [deps, 'node_modules'] },
  module: {rules: [{test: /\.css$/, type: 'asset/source'}, {test: /\.(ttf|woff2?|png|svg)$/, type: 'asset/resource'}]},
  plugins: [new webpack.DefinePlugin({'process.env': JSON.stringify({...env, NODE_ENV: 'development'})})],
}, (err, stats) => {
  if (err || stats.hasErrors()) {
    console.error(err || stats.toString({all:false, errors:true}));
    process.exitCode = 1; return;
  }
  fs.copyFileSync(path.join(__dirname, 'index.html'), path.join(output, 'index.html'));
  fs.writeFileSync(path.join(output, 'empty.css'), 'i.fa-solid::before { content: "◦"; }');
  console.log('Built local editor and ledger components');
});
