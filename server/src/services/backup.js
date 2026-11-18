'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const env = require('../config/env');

const DIR = path.resolve(__dirname, '../../backups');
const KEEP = 14;

function findMysqldump() {
  if (env.MYSQLDUMP_PATH) return env.MYSQLDUMP_PATH;
  if (process.platform === 'win32') {
    for (const root of ['C:\\Program Files\\MySQL', 'C:\\Program Files (x86)\\MySQL']) {
      if (!fs.existsSync(root)) continue;
      for (const d of fs.readdirSync(root)) {
        const p = path.join(root, d, 'bin', 'mysqldump.exe');
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return 'mysqldump'; // rely on PATH
}

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const fileFor = (d) => path.join(DIR, `${env.DB_NAME}-${stamp(d)}.sql`);

function backupDone(d = new Date()) { return fs.existsSync(fileFor(d)); }

/** Dump the database to server/backups/<db>-YYYY-MM-DD.sql and prune old dumps. */
function runBackup() {
  fs.mkdirSync(DIR, { recursive: true });
  const out = fileFor();
  const tmp = `${out}.partial`;
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(tmp);
    // password goes through MYSQL_PWD so it never shows up in the process list
    const child = spawn(findMysqldump(), [
      '-h', env.DB_HOST, '-P', String(env.DB_PORT), '-u', env.DB_USER,
      '--single-transaction', '--routines', '--default-character-set=utf8mb4', env.DB_NAME,
    ], { env: { ...process.env, MYSQL_PWD: env.DB_PASSWORD } });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdout.pipe(ws);
    child.on('error', (e) => { ws.destroy(); fs.rmSync(tmp, { force: true }); reject(new Error(`mysqldump could not start: ${e.message}. Set MYSQLDUMP_PATH in .env`)); });
    child.on('close', (code) => {
      ws.end(() => {
        if (code !== 0) { fs.rmSync(tmp, { force: true }); return reject(new Error(`mysqldump exited with ${code}: ${stderr.trim()}`)); }
        fs.renameSync(tmp, out);
        prune();
        resolve(out);
      });
    });
  });
}

function prune() {
  const files = fs.readdirSync(DIR).filter((f) => f.startsWith(`${env.DB_NAME}-`) && f.endsWith('.sql')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - KEEP))) fs.rmSync(path.join(DIR, f), { force: true });
}

module.exports = { runBackup, backupDone };
