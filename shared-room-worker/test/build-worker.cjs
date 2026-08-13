const { execFileSync } = require('node:child_process');
const { resolve } = require('node:path');

const executable = process.execPath;
const wrangler = resolve(__dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');

execFileSync(executable, [wrangler, 'deploy', '--dry-run', '--outdir', '.wrangler-test-build'], {
  cwd: resolve(__dirname, '..'),
  stdio: 'inherit'
});
