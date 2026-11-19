'use strict';
/** Short human-readable summaries for MCP tool results (the JSON goes in structuredContent). */

const when = (d) => (d ? new Date(d).toISOString() : null);

function project(p) {
  const lines = [`Project "${p.name}" (${p.id})`];
  for (const c of p.connections) {
    lines.push(`- ${c.platform}: ${c.connected ? `connected as ${c.accountName || c.accountId}${c.status && c.status !== 'active' ? ` (${c.status})` : ''}` : (c.status === 'expired' ? 'EXPIRED, reconnect in the app' : 'not connected')}`);
  }
  const s = p.settings || {};
  if (s.captionFooter) lines.push(`Caption footer (added automatically): ${s.captionFooter}`);
  if (s.hashtags) lines.push(`Hashtags (added automatically): ${s.hashtags}`);
  if (s.mcpPublishNow === false) lines.push('This project only allows AI clients to SCHEDULE posts (publishNow must be false, at least 10 minutes ahead).');
  return lines.join('\n');
}

function media(m) {
  const dims = m.width && m.height ? ` ${m.width}x${m.height}` : '';
  const dur = m.duration != null ? `, ${m.duration}s` : '';
  return `Uploaded media id ${m.id}: ${m.kind}${dims}${dur}, "${m.name}". Suggested contentType: ${m.suggestedType}. Use mediaIds: [${m.id}] in validate_post / create_post.`;
}

function validation(results) {
  const lines = [];
  for (const [pl, r] of Object.entries(results)) {
    if (!r.supported) { lines.push(`- ${pl}: SKIPPED (${r.reason})`); continue; }
    if (r.errors.length) lines.push(`- ${pl}: ERRORS: ${r.errors.join('; ')}`);
    else lines.push(`- ${pl}: OK`);
    if (r.warnings.length) lines.push(`  warnings: ${r.warnings.join('; ')}`);
  }
  const ok = Object.values(results).some((r) => r.supported) && !Object.values(results).some((r) => r.supported && r.errors.length);
  return `${ok ? 'Valid. Ready for create_post (confirm with the user first).' : 'Not valid yet. Fix the errors and validate again.'}\n${lines.join('\n')}`;
}

function target(t) {
  const bits = [`- ${t.platform}: ${t.status}`];
  if (t.status === 'uploading' || t.status === 'processing') bits.push(`${t.progress || 0}%`);
  if (t.externalUrl) bits.push(t.externalUrl);
  if (t.errorMessage) bits.push(`(${t.errorMessage})`);
  if (t.nextAttemptAt && t.status === 'pending') bits.push(`next attempt ${when(t.nextAttemptAt)}`);
  return bits.join(' ');
}

function post(p) {
  const head = `Post #${p.id} (${p.contentType}): ${p.status}${p.scheduledAt ? `, scheduled for ${when(p.scheduledAt)}` : ''}`;
  const cap = p.caption ? `\nCaption: ${p.caption.length > 140 ? `${p.caption.slice(0, 140)}…` : p.caption}` : '';
  return `${head}${cap}\n${(p.targets || []).map(target).join('\n')}`;
}

function postList(r) {
  if (!r.posts.length) return `No posts (page ${r.page}, ${r.total} total).`;
  return `${r.total} post(s), page ${r.page}:\n${r.posts.map((p) => `#${p.id} ${p.contentType} ${p.status}${p.scheduledAt ? ` scheduled ${when(p.scheduledAt)}` : ''} [${p.targets.map((t) => `${t.platform}:${t.status}`).join(', ')}]${p.caption ? ` "${p.caption.slice(0, 60).replace(/\s+/g, ' ')}${p.caption.length > 60 ? '…' : ''}"` : ''}`).join('\n')}`;
}

module.exports = { project, media, validation, post, postList };
