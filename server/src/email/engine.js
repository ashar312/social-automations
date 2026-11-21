'use strict';
const cron = require('node-cron');
const env = require('../config/env');
const sender = require('./sender');
const dailySummary = require('./jobs/dailySummary');
const lifecycle = require('./jobs/lifecycle');

let tasks = [];

const guard = (name, fn) => () => Promise.resolve().then(() => fn()).catch((e) => console.error(`[email] ${name} failed:`, e.message));

/** Starts the sender loop and the cron jobs (EMAIL_ENGINE_ENABLED=false turns both off). */
function start() {
  if (!env.EMAIL_ENGINE_ENABLED) { console.log('Email engine disabled (EMAIL_ENGINE_ENABLED=false)'); return; }
  if (tasks.length) return;
  sender.start();
  tasks = [
    cron.schedule('0 * * * *', guard('daily summary', dailySummary.run)), // every hour on the hour
    cron.schedule('*/15 * * * *', guard('lifecycle scan', lifecycle.run)), // every 15 minutes
  ];
  // catch up after downtime shortly after boot (jobs are idempotent)
  setTimeout(guard('daily summary', dailySummary.run), 45 * 1000).unref();
  setTimeout(guard('lifecycle scan', lifecycle.run), 60 * 1000).unref();
  console.log(`Email engine started${env.EMAIL_DRY_RUN ? ' (dry run: emails are logged, not sent)' : ''}`);
}

function stop() {
  sender.stop();
  for (const t of tasks) t.stop();
  tasks = [];
}
module.exports = { start, stop };
