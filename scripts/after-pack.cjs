// electron-builder drops node_modules and dot-folders from extraResources,
// so copy the Next.js standalone server into the app bundle ourselves.
const fs = require('node:fs');
const path = require('node:path');
exports.default = async (ctx) => {
  const app = fs.readdirSync(ctx.appOutDir).find((f) => f.endsWith('.app'));
  const dest = path.join(ctx.appOutDir, app, 'Contents', 'Resources', 'server');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(path.join(__dirname, '..', '.next', 'standalone'), dest, { recursive: true, verbatimSymlinks: true });
  console.log('  • copied server bundle →', dest);
};
