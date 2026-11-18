'use strict';
const fs = require('fs');
const env = require('./config/env');
const app = require('./app');
const worker = require('./worker/publisher');

fs.mkdirSync(env.UPLOAD_ROOT, { recursive: true });
const server = app.listen(env.PORT, env.HOST, () => {
  console.log(`Server listening on http://${env.HOST}:${env.PORT}`);
  worker.start().catch((e) => console.error('Worker failed to start:', e.message));
});
server.requestTimeout = 0; // big uploads
server.headersTimeout = 65000;
process.on('SIGINT', () => { worker.stop(); process.exit(0); });
