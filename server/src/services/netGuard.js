'use strict';
/**
 * SSRF guard for server-side downloads (media import by URL from the external API and MCP).
 * An AI client can be prompt-injected into "importing" an internal URL, so private, loopback,
 * link-local and other non-public addresses are refused: on the first request, on every redirect,
 * and at connect time (custom DNS lookup), which also covers DNS rebinding.
 */
const net = require('net');
const dns = require('dns');
const http = require('http');
const https = require('https');
const axios = require('axios');

const blocked = new net.BlockList();
for (const [a, p] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(a, p, 'ipv4');
for (const [a, p] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96], ['2001:db8::', 32]]) {
  blocked.addSubnet(a, p, 'ipv6');
}

/** true when the IP literal is not a public unicast address. */
function isPrivateIp(ip) {
  const fam = net.isIP(ip);
  if (fam === 4) return blocked.check(ip, 'ipv4');
  if (fam === 6) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return blocked.check(mapped[1], 'ipv4');
    return blocked.check(ip, 'ipv6');
  }
  return true;
}

const refused = (host) => Object.assign(new Error(`Refusing to download from ${host}: it is a private or local network address`), { status: 400 });

/** dns.lookup replacement that fails for non-public answers. */
function guardedLookup(hostname, options, cb) {
  if (typeof options === 'function') { cb = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err);
    const bad = addrs.find((a) => isPrivateIp(a.address));
    if (bad) return cb(refused(hostname));
    if (options.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

const stripBrackets = (h) => h.replace(/^\[|\]$/g, '');
function assertPublicHost(hostname) {
  const h = stripBrackets(hostname);
  if (/^localhost$/i.test(h) || /\.localhost$/i.test(h)) throw refused(h);
  if (net.isIP(h) && isPrivateIp(h)) throw refused(h);
}

const httpAgent = new http.Agent({ lookup: guardedLookup });
const httpsAgent = new https.Agent({ lookup: guardedLookup });

/** axios GET (stream) that only reaches public addresses. Resolves with the axios response (any status). */
async function safeGet(url, { timeout = 60_000 } = {}) {
  assertPublicHost(new URL(url).hostname);
  try {
    return await axios.get(url, {
      responseType: 'stream', timeout, maxRedirects: 5, validateStatus: () => true,
      httpAgent, httpsAgent,
      beforeRedirect: (opts) => assertPublicHost(opts.hostname || new URL(opts.href).hostname),
    });
  } catch (e) {
    if (e.status) throw e;
    const inner = e.cause && e.cause.status ? e.cause : null;
    if (inner) throw inner;
    if (/private or local network/.test(e.message)) throw Object.assign(new Error(e.message), { status: 400 });
    throw Object.assign(new Error(`Download failed: ${e.message}`), { status: 400 });
  }
}

module.exports = { safeGet, isPrivateIp, assertPublicHost };
