'use strict';
const fs = require('fs');
const env = require('./config/env');
const app = require('./app');
const worker = require('./worker/publisher');

fs.mkdirSync(env.UPLOAD_ROOT, { recursive: true });

let started = false;
function onListening() {
  if (started) return;
  started = true;
  console.log(`Server listening on ${env.SCHEME}://${env.HOST}:${env.PORT}`);
  worker.start().catch((e) => console.error('Worker failed to start:', e.message));
}
function onListenError(err) {
  // never start a second worker against the same DB
  console.error(`Could not listen on ${env.HOST}:${env.PORT}: ${err.message}. Is another server already running?`);
  process.exit(1);
}

let server;
if (env.HTTPS) {
  // https.Server does not pass listen errors to the callback, so listen for 'error' instead.
  // No HSTS: on localhost it would stick for every port and break other local HTTP projects.
  const tls = { cert: fs.readFileSync(env.TLS_CERT_PATH), key: fs.readFileSync(env.TLS_KEY_PATH) };
  server = require('https').createServer(tls, app);
  server.once('error', onListenError);
  server.listen(env.PORT, env.HOST, onListening);
} else {
  // Express 5 passes listen errors (e.g. EADDRINUSE) to the callback.
  server = app.listen(env.PORT, env.HOST, (err) => (err ? onListenError(err) : onListening()));
}
server.requestTimeout = 0; // big uploads
server.headersTimeout = 65000;
process.on('SIGINT', () => { worker.stop(); process.exit(0); });
