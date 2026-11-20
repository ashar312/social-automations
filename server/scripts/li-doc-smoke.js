'use strict';
/**
 * B1 of plans/07-linkedin-pdf-carousel.md: check the LinkedIn Documents API shapes for LINKEDIN_API_VERSION.
 * Uploads a generated 3-page PDF, polls until AVAILABLE, creates a CONNECTIONS-only test post, prints every
 * request/response shape, then deletes the post again.
 *
 *   node --use-system-ca scripts/li-doc-smoke.js [platformAccountId]
 *   node --use-system-ca scripts/li-doc-smoke.js [platformAccountId] --keep   (don't delete; check the feed yourself)
 *
 * Without an id it uses the first connected LinkedIn account.
 */
const axios = require('axios');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { PlatformAccount } = require('../src/db/models');
const { ensureFresh } = require('../src/services/tokens');
const { headers, API } = require('../src/platforms/linkedin');
const env = require('../src/config/env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const show = (label, v) => console.log(`\n── ${label}\n${JSON.stringify(v, null, 2)}`);

async function testPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const colors = [rgb(0.49, 0.36, 1), rgb(0.1, 0.6, 0.5), rgb(0.95, 0.5, 0.2)];
  for (let i = 0; i < 3; i++) {
    const page = pdf.addPage([1080, 1350]);
    page.drawRectangle({ x: 0, y: 0, width: 1080, height: 1350, color: colors[i] });
    page.drawText(`Slide ${i + 1} / 3`, { x: 120, y: 650, size: 110, font, color: rgb(1, 1, 1) });
  }
  return Buffer.from(await pdf.save());
}

(async () => {
  const id = Number(process.argv.find((a, i) => i > 1 && /^\d+$/.test(a)));
  const keep = process.argv.includes('--keep');
  const model = id ? await PlatformAccount.findByPk(id) : await PlatformAccount.findOne({ where: { platform: 'linkedin', status: 'connected' } });
  if (!model || model.platform !== 'linkedin') throw new Error('No connected LinkedIn account found (pass a platform_accounts id)');
  const acc = await ensureFresh(model);
  console.log(`LinkedIn-Version ${env.LINKEDIN_API_VERSION}, owner ${acc.externalId}`);

  const init = await axios.post(`${API}/documents?action=initializeUpload`, { initializeUploadRequest: { owner: acc.externalId } }, { headers: headers(acc) });
  show('initializeUpload response', init.data);
  const { uploadUrl, document } = init.data.value;

  const bytes = await testPdf();
  const put = await axios.put(uploadUrl, bytes, {
    headers: { Authorization: `Bearer ${acc.accessToken}`, 'Content-Type': 'application/octet-stream' }, maxBodyLength: Infinity,
  });
  console.log(`\n── PUT upload: HTTP ${put.status} (${bytes.length} bytes)`);

  let doc;
  for (let i = 0; i < 60; i++) {
    doc = (await axios.get(`${API}/documents/${encodeURIComponent(document)}`, { headers: headers(acc) })).data;
    console.log(`status: ${doc.status}`);
    if (doc.status === 'AVAILABLE' || doc.status === 'PROCESSING_FAILED') break;
    await sleep(3000);
  }
  show('GET document (final)', doc);
  if (doc.status !== 'AVAILABLE') throw new Error(`Document not available: ${doc.status}`);

  const body = {
    author: acc.externalId,
    commentary: 'Carousel API test (will be deleted)',
    visibility: 'CONNECTIONS',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: document, title: 'API smoke test carousel' } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };
  show('POST /posts body', body);
  const post = await axios.post(`${API}/posts`, body, { headers: headers(acc) });
  const urn = post.headers['x-restli-id'];
  console.log(`\n── Post created: HTTP ${post.status}, x-restli-id ${urn}\nhttps://www.linkedin.com/feed/update/${urn}`);

  if (keep) {
    console.log('\n--keep: not deleting. Delete it from the feed when done.');
  } else {
    await sleep(5000);
    const del = await axios.delete(`${API}/posts/${encodeURIComponent(urn)}`, { headers: headers(acc) });
    console.log(`\n── Deleted: HTTP ${del.status}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('\nFAILED:', e.response ? `HTTP ${e.response.status} ${JSON.stringify(e.response.data)}` : e.message);
  process.exit(1);
});
