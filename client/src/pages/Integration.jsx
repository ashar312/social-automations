import { useEffect, useState } from 'react'
import { FaCode, FaRobot } from 'react-icons/fa6'
import { api, PLATFORMS, PLATFORM_LABEL } from '../api.js'
import { Notice, PageTitle, PlatformIcon } from '../components/ui.jsx'
import { ApiAccess, Copy } from '../projects/ApiAccess.jsx'
import { useProject } from '../projects/useProject.js'

const TABS = [['api', 'API', FaCode], ['mcp', 'MCP', FaRobot]]

export default function Integration() {
  const [tab, setTab] = useState('api')
  return (
    <div>
      <PageTitle eyebrow="Developers" title="Integration" />
      <div className="mb-6 inline-flex gap-1 rounded-xl bg-sunken p-1" role="tablist" aria-label="Integration type">
        {TABS.map(([id, label, Icon]) => (
          <button key={id} id={`tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`panel-${id}`} onClick={() => setTab(id)} className="tab-btn">
            <Icon aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {tab === 'api' ? <ApiGuide /> : <McpTab />}
      </div>
    </div>
  )
}

/* ---------- MCP guide ---------- */

const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'
const KEY_PLACEHOLDER = '<your API key>'
// Scheme of the API server: from /api/config once loaded, else the page's own (UI and API share it)
const scheme = (cfg) => (cfg ? (cfg.https ? 'https' : 'http') : window.location.protocol.replace(':', ''))

// Remount per project so the just-generated key and tool list never leak across projects.
function McpTab() {
  const { active } = useProject()
  return <McpGuide key={active.id} />
}

function McpGuide() {
  const { active, reload } = useProject()
  const [cfg, setCfg] = useState(null)
  const [key, setKey] = useState('') // plain key, only right after "Generate"
  const [info, setInfo] = useState(null)
  const [infoError, setInfoError] = useState('')
  useEffect(() => { api.get('/api/config').then((d) => setCfg(d.api)).catch(() => setCfg(null)) }, [])
  useEffect(() => {
    api.get(`/api/projects/${active.id}/mcp`).then(setInfo).catch((e) => setInfoError(e.message))
  }, [active.id])

  const url = cfg?.mcpLocal || `${scheme(cfg)}://localhost:5000/api/v1/mcp`
  const name = `social-${slug(active.name)}`
  const k = key || KEY_PLACEHOLDER

  return (
    <div className="space-y-5">
      <Section title="How it works">
        <p>
          The MCP server lets AI apps (Claude Code, Claude Desktop, Cursor, VS Code and others) use this project&apos;s connected accounts as <b>tools</b>:
          upload media, write and check captions, publish or schedule, and report the live links. For example: <i>&quot;Post this clip as a Reel to Instagram and YouTube tomorrow at 9am.&quot;</i>
        </p>
        <p className="text-muted">
          The AI never sees your platform tokens. It uses the same per-project API key as the API tab, so one key can only post to <b>{active.name}</b>.
          Publishing and deleting are marked as destructive, so AI apps ask you before running them.
        </p>
        {cfg && cfg.mcpEnabled === false && <Notice>The MCP server is turned off. Set <C>MCP_ENABLED=true</C> in <C>server/.env</C> and restart.</Notice>}
      </Section>

      <Section n="1" title={`API key for "${active.name}"`}>
        <p>Generate a key here. Right after you generate it, the setup snippets below include it; later it is shown as <C>{KEY_PLACEHOLDER}</C>.</p>
        <ApiAccess key={active.id} project={active} onChange={reload} onKey={setKey} />
      </Section>

      <Section n="2" title="Add it to your AI app">
        <Snippets label="AI app" items={clientSnippets({ url, name, k, cfg })} />
        <p className="text-muted">
          claude.ai and ChatGPT connectors need a sign-in flow (OAuth) that isn&apos;t built yet. Use Claude Code, Claude Desktop or an editor for now.
        </p>
      </Section>

      <Section n="3" title="Where to reach it">
        <Table head={['AI app runs on', 'MCP URL', 'Setup']} rows={[
          ['This computer', <C>{url}</C>, 'Nothing to do.'],
          ['Another machine on your network', <C>{scheme(cfg)}://&lt;this-PC-IP&gt;:5000/api/v1/mcp</C>, <>Set <C>HOST=0.0.0.0</C> in <C>server/.env</C> and allow port 5000.{cfg?.https && <> The other machine must trust this PC&apos;s mkcert CA.</>}{cfg?.host === '0.0.0.0' && <span className="pill pill-good ml-1">On</span>}</>],
          ['A cloud service (Claude API MCP connector)', cfg?.mcpTunnel ? <C>{cfg.mcpTunnel}</C> : <C>https://&lt;tunnel-host&gt;/api/v1/mcp</C>, <>Public tunnel plus <C>API_OVER_TUNNEL=true</C>.{cfg?.mcpTunnel ? <span className="pill pill-good ml-1">On</span> : <span className="pill pill-mute ml-1">Off</span>}</>],
        ]} />
        <p className="text-muted">The server must be running: its background worker does the actual publishing.</p>
      </Section>

      <Section n="4" title="Test the connection">
        <McpTest key={key} project={active} initialKey={key} />
      </Section>

      <Section n="5" title="Safety">
        <ScheduleOnly project={active} onChange={reload} />
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>AI apps ask before <b>create_post</b> and <b>delete_post</b>. Don&apos;t turn on &quot;always allow&quot; for those two.</li>
          <li>Limits per key: {cfg ? 'tool calls per minute and posts per hour' : 'calls and posts'} (<C>MCP_RATE_PER_MIN</C>, <C>MCP_POSTS_PER_HOUR</C>). Every tool call is logged.</li>
          <li>The server refuses to download from private or local network addresses, so a web page can&apos;t trick the AI into fetching internal URLs.</li>
          <li>{cfg?.mcpLocalFiles
            ? <>Local file uploads are <b>on</b> for the folders in <C>MCP_ALLOWED_DIRS</C>, only for AI apps on this computer.</>
            : <>Local file uploads are off. To let the AI upload rendered videos from your disk, set <C>MCP_ALLOWED_DIRS</C> to those folders.</>}</li>
          <li>If a key leaks, click <b>New key</b> in step 1. The old one stops working at once.</li>
        </ul>
      </Section>

      <Section title="What the AI can do" id="mcp-tools">
        {infoError && <Notice>{infoError}</Notice>}
        {!info && !infoError && <p className="text-muted">Loading…</p>}
        {info && <McpCatalog info={info} />}
      </Section>
    </div>
  )
}

function clientSnippets({ url, name, k, cfg }) {
  const auth = { Authorization: `Bearer ${k}` }
  const json = (o) => JSON.stringify(o, null, 2)
  const remote = cfg?.mcpTunnel || 'https://<tunnel-host>/api/v1/mcp'
  return [
    ['Claude Code', `claude mcp add --transport http ${name} ${url} \\
  --header "Authorization: Bearer ${k}"

# add --scope user to use it in every folder, then check with:
claude mcp list`],
    ['Claude Desktop', `// Settings → Developer → Edit Config (claude_desktop_config.json), then restart Claude Desktop
${json({
  mcpServers: {
    [name]: {
      command: 'node',
      // --use-system-ca: Node trusts the local (mkcert) HTTPS certificate
      args: [...(cfg?.https ? ['--use-system-ca'] : []), cfg?.mcpBridge || 'C:/path/to/social-automations/server/bin/mcp-stdio.js'],
      env: { SA_API_KEY: k, SA_MCP_URL: url },
    },
  },
})}`],
    ['Cursor', `// .cursor/mcp.json (this folder) or ~/.cursor/mcp.json (everywhere)
${json({ mcpServers: { [name]: { url, headers: auth } } })}`],
    ['VS Code', `// .vscode/mcp.json  (VS Code asks for the key once and stores it securely)
${json({
  inputs: [{ type: 'promptString', id: 'sa-api-key', description: 'Social Automations API key', password: true }],
  servers: { [name]: { type: 'http', url, headers: { Authorization: 'Bearer ${input:sa-api-key}' } } },
})}`],
    ['Windsurf', `// ~/.codeium/windsurf/mcp_config.json
${json({ mcpServers: { [name]: { serverUrl: url, headers: auth } } })}`],
    ['Agent SDK', `// Claude Agent SDK (TypeScript): npm i @anthropic-ai/claude-agent-sdk
import { query } from '@anthropic-ai/claude-agent-sdk'

for await (const msg of query({
  prompt: 'List my last 5 posts and their status.',
  options: {
    mcpServers: {
      social: { type: 'http', url: '${url}', headers: { Authorization: \`Bearer \${process.env.SA_API_KEY}\` } },
    },
  },
})) {
  if (msg.type === 'result') console.log(msg.result)
}`],
    ['Claude API', `// Messages API MCP connector. Anthropic's servers call the URL, so it must be public (tunnel).
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()
const response = await client.beta.messages.create({
  model: 'claude-opus-5-5',
  max_tokens: 16000,
  betas: ['mcp-client-2025-11-20'],
  mcp_servers: [{ type: 'url', name: 'social', url: '${remote}', authorization_token: process.env.SA_API_KEY }],
  tools: [{ type: 'mcp_toolset', mcp_server_name: 'social' }],
  messages: [{ role: 'user', content: 'List my last 5 posts and their status.' }],
})`],
  ]
}

function McpTest({ project, initialKey }) {
  const [key, setKey] = useState(initialKey || '')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  async function run(e) {
    e.preventDefault()
    setBusy(true); setError(''); setResult(null)
    try { setResult(await api.post(`/api/projects/${project.id}/mcp/test`, { key })) } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <form onSubmit={run} className="space-y-3">
      <p>Connects to the MCP endpoint exactly like an AI app would (HTTP, with the key), lists the tools and calls <C>get_project</C>.</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-[16rem] flex-1">
          <span className="mb-1 block text-xs font-semibold text-muted">API key</span>
          <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sa_live_…" className="field" />
        </label>
        <button type="submit" disabled={busy || !key.trim()} className="btn btn-primary">{busy ? 'Testing…' : 'Test connection'}</button>
      </div>
      {!project.apiKey && <p className="text-muted">This project has no key yet. Generate one in step 1.</p>}
      {error && <Notice>{error}</Notice>}
      {result && (
        <Notice tone="good">
          Connected in {result.ms} ms to {result.server?.title || result.server?.name} {result.server?.version} · {result.toolCount} tools
          {result.protocolVersion && <> · MCP {result.protocolVersion}</>}
          {result.project && (
            <span className="mt-2 flex flex-wrap gap-1.5">
              {result.project.connections.map((c) => (
                <span key={c.platform} className={`pill ${c.connected ? 'pill-good' : 'pill-mute'}`}>
                  <PlatformIcon platform={c.platform} size="xs" />{PLATFORM_LABEL[c.platform]}: {c.connected ? 'connected' : 'not connected'}
                </span>
              ))}
            </span>
          )}
        </Notice>
      )}
    </form>
  )
}

function ScheduleOnly({ project, onChange }) {
  const scheduleOnly = project.settings?.mcpPublishNow === false
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function toggle() {
    setBusy(true); setError('')
    try { await api.patch(`/api/projects/${project.id}`, { settings: { mcpPublishNow: scheduleOnly } }); await onChange() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="rounded-xl border border-line p-3">
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 size-4 accent-[var(--color-brand)]" checked={scheduleOnly} disabled={busy} onChange={toggle} />
        <span>
          <span className="font-semibold text-ink">AI must schedule, not publish now</span>
          <span className="block text-muted">AI apps can only schedule posts at least 10 minutes ahead, so you can check them in History and delete any you don&apos;t want. Applies to this project only.</span>
        </span>
      </label>
      {error && <div className="mt-2"><Notice>{error}</Notice></div>}
    </div>
  )
}

function toolBadge(a = {}) {
  if (a.readOnlyHint) return <span className="pill pill-good">Read-only</span>
  if (a.destructiveHint) return <span className="pill pill-bad">Destructive · asks first</span>
  return <span className="pill pill-warn">Changes data</span>
}

function McpCatalog({ info }) {
  return (
    <>
      <Table head={['Tool', 'Kind', 'What it does']} rows={info.tools.map((t) => [
        <C>{t.name}</C>, toolBadge(t.annotations), <span className="text-muted">{t.description}</span>,
      ])} />
      <h3 className="pt-2 font-semibold text-ink">Prompts (slash commands in apps that support them)</h3>
      <Table head={['Prompt', 'What it does']} rows={info.prompts.map((p) => [<C>{p.name}</C>, <span className="text-muted">{p.description}</span>])} />
      <h3 className="pt-2 font-semibold text-ink">Resources (context the AI app can attach)</h3>
      <p className="flex flex-wrap gap-1.5">{info.resources.map((r) => <C key={r}>{r}</C>)}</p>
    </>
  )
}

/* ---------- small building blocks ---------- */

function Code({ children, label = 'code' }) {
  return (
    <div className="relative mt-2">
      <pre className="overflow-x-auto rounded-xl border border-line bg-[#0f1225] p-4 pr-24 text-[0.78rem] leading-relaxed text-[#e4e7ef]"><code>{children}</code></pre>
      <div className="absolute right-2 top-2"><Copy text={children} label={label} /></div>
    </div>
  )
}

function Section({ n, title, children, id }) {
  return (
    <section id={id} className="card scroll-mt-6 p-5 sm:p-6">
      <h2 className="card-title mb-3 flex items-center gap-2.5">{n && <span className="step-num">{n}</span>}{title}</h2>
      <div className="space-y-3 text-sm">{children}</div>
    </section>
  )
}

function Table({ head, rows }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-sunken text-xs uppercase tracking-wide text-muted">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-3 py-2 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line align-top">
              {r.map((c, j) => <td key={j} className="px-3 py-2">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const C = ({ children }) => <code className="rounded bg-sunken px-1 py-0.5 text-[0.8em] text-ink">{children}</code>

function Snippets({ items, label = 'Language' }) {
  const [lang, setLang] = useState(items[0][0])
  const current = items.find(([l]) => l === lang)
  return (
    <div>
      <div className="inline-flex max-w-full flex-wrap gap-1 rounded-xl bg-sunken p-1" role="tablist" aria-label={label}>
        {items.map(([l]) => <button key={l} role="tab" aria-selected={lang === l} onClick={() => setLang(l)} className="tab-btn">{l}</button>)}
      </div>
      <Code label={`${lang} example`}>{current[1]}</Code>
    </div>
  )
}

/* ---------- API guide ---------- */

function ApiGuide() {
  const { active, reload } = useProject()
  const [cfg, setCfg] = useState(null)
  useEffect(() => { api.get('/api/config').then((d) => setCfg(d.api)).catch(() => setCfg(null)) }, [])

  const base = cfg?.localBase || `${scheme(cfg)}://127.0.0.1:5000/api/v1`
  const pid = active.publicId
  const env = `export SA_BASE=${base}\nexport SA_PROJECT_ID=${pid}\nexport SA_API_KEY=sa_live_xxxxxxxx   # from step 1`

  return (
    <div className="space-y-5">
      <Section title="How it works">
        <p>
          Other systems (scripts, n8n, Zapier, a CMS, another backend) publish through the accounts already connected in this app.
          They never see your LinkedIn, YouTube or Meta tokens. They get a <b>project ID</b> and that project&apos;s <b>API key</b>.
        </p>
        <Table head={['Piece', 'Example', 'What it does']} rows={[
          ['Project ID', <C>{pid}</C>, 'Unique per project and never changes. Goes in the URL.'],
          ['API key', <C>sa_live_…</C>, 'Secret, one per project. Goes in the Authorization header.'],
          ['Platform', <C>linkedin · youtube · facebook · instagram</C>, 'Picks the account inside that project (one per platform).'],
        ]} />
        <p className="text-muted">
          If the key belongs to another project than the one in the URL, the call is refused (403 <C>project_mismatch</C>), so a script can&apos;t post to the wrong brand.
        </p>
      </Section>

      <Section n="1" title={`Get credentials for "${active.name}"`}>
        <p>Every example on this page already uses this project&apos;s ID. Switch project in the sidebar to see another one.</p>
        <ApiAccess project={active} onChange={reload} />
        <p className="text-muted">Store the key like a password (env var or secret store). Never put it in front-end code or a public repo.</p>
      </Section>

      <Section n="2" title="Where to call it">
        <Table head={['Caller', 'Base URL', 'Setup']} rows={[
          ['Same computer', <C>{base}</C>, 'Nothing to do.'],
          ['Another machine on your network', <C>{scheme(cfg)}://&lt;this-PC-IP&gt;:5000/api/v1</C>, <>Set <C>HOST=0.0.0.0</C> in <C>server/.env</C>, restart, allow port 5000 in the firewall.{cfg?.host === '0.0.0.0' && <span className="pill pill-good ml-1">On</span>}</>],
          ['Cloud service (Zapier, n8n cloud)', cfg?.tunnelBase ? <C>{cfg.tunnelBase}</C> : <C>https://&lt;tunnel-host&gt;/api/v1</C>, <>Set up the public tunnel and <C>API_OVER_TUNNEL=true</C> in <C>server/.env</C>.{cfg?.tunnelBase ? <span className="pill pill-good ml-1">On</span> : <span className="pill pill-mute ml-1">Off</span>}</>],
        ]} />
        <p className="text-muted">Only <C>/api/v1</C> answers other machines. The server must be running: its background worker does the publishing.</p>
      </Section>

      <Section n="3" title="Test the connection">
        <p>Set these once in your terminal, then call <C>/me</C>. It returns the project and which accounts are connected.</p>
        <Code label="environment variables">{env}</Code>
        <Code label="test call">{'curl "$SA_BASE/me" -H "Authorization: Bearer $SA_API_KEY"'}</Code>
        <p className="text-muted">You can also send the key as <C>X-API-Key: sa_live_…</C>.</p>
      </Section>

      <Section n="4" title="Upload media">
        <p>Skip this for text-only posts. Upload a file, or let the server download one from a URL. Both return a media <C>id</C>.</p>
        <Code label="file upload">{'curl -X POST "$SA_BASE/projects/$SA_PROJECT_ID/media" \\\n  -H "Authorization: Bearer $SA_API_KEY" \\\n  -F "file=@./clip.mp4"'}</Code>
        <Code label="import from URL">{'curl -X POST "$SA_BASE/projects/$SA_PROJECT_ID/media" \\\n  -H "Authorization: Bearer $SA_API_KEY" -H "Content-Type: application/json" \\\n  -d \'{"url": "https://example.com/files/clip.mp4"}\''}</Code>
        <Code label="response">{'{ "ok": true, "id": 42, "kind": "video", "width": 1080, "height": 1920,\n  "duration": 31.5, "mime": "video/mp4", "suggestedType": "reel" }'}</Code>
        <ul className="list-disc space-y-1 pl-5 text-muted">
          <li>jpg, png, webp (converted to jpg), mp4, mov.</li>
          <li><C>suggestedType</C> is a hint for <C>contentType</C> in the next step.</li>
          <li>A media id can be used in one post. Upload again for another post.</li>
        </ul>
      </Section>

      <Section n="5" title="Create the post">
        <Code label="create post">{`curl -X POST "$SA_BASE/projects/$SA_PROJECT_ID/posts" \\
  -H "Authorization: Bearer $SA_API_KEY" -H "Content-Type: application/json" \\
  -d '{
    "contentType": "reel",
    "caption": "Launch day!",
    "title": "Our launch in 30 seconds",
    "mediaIds": [42],
    "targets": [
      { "platform": "instagram" },
      { "platform": "facebook" },
      { "platform": "youtube", "overrides": { "privacy": "public", "tags": ["launch"] } },
      { "platform": "linkedin", "overrides": { "caption": "We launched today." } }
    ],
    "publishNow": true
  }'`}</Code>
        <p>Returns <C>201 {'{ "ok": true, "id": 123, "status": "queued" }'}</C>. The worker picks it up within seconds.</p>
        <p>Want to check first without creating anything? Send the same body to <C>/posts/validate</C>.</p>

        <h3 className="pt-2 font-semibold text-ink">Body fields</h3>
        <Table head={['Field', 'Type', 'Notes']} rows={[
          [<C>contentType</C>, 'text | image | video | reel', 'Required. reel = vertical short video (Reels / Shorts).'],
          [<C>caption</C>, 'string', "Post text or video description. The project's caption footer and hashtags are added automatically."],
          [<C>title</C>, 'string', 'Needed for YouTube.'],
          [<C>mediaIds</C>, 'number[]', 'From step 4, in display order. Several images make a carousel where supported.'],
          [<C>targets</C>, 'array (min 1)', <>Each <C>{'{ platform, overrides? }'}</C>.</>],
          [<C>publishNow</C>, 'boolean', 'Default true.'],
          [<C>scheduledAt</C>, 'ISO 8601', <>Used when publishNow is false, e.g. <C>2026-11-25T09:00:00+05:00</C>.</>],
        ]} />

        <h3 className="pt-2 font-semibold text-ink">Per-platform overrides (optional)</h3>
        <Table head={['Key', 'Platforms', 'Meaning']} rows={[
          [<C>caption</C>, 'all', 'Replaces the main caption on this platform.'],
          [<C>title</C>, 'YouTube', 'Replaces the main title.'],
          [<C>privacy</C>, 'YouTube', 'public, unlisted or private. Forced to private until the YouTube API audit passes.'],
          [<C>tags</C>, 'YouTube', 'Array or comma-separated string.'],
          [<C>categoryId</C>, 'YouTube', 'YouTube category id (default 22).'],
          [<C>shareToFeed</C>, 'Instagram', 'false = Reel only in the Reels tab.'],
        ]} />

        <h3 className="pt-2 font-semibold text-ink">What each platform accepts</h3>
        <SupportMatrix />
        <p className="text-muted">Unsupported platforms are skipped (not an error) as long as one target is supported. Instagram also needs the public media URL set up.</p>
      </Section>

      <Section n="6" title="Track, retry, delete">
        <Code label="get post">{'curl "$SA_BASE/projects/$SA_PROJECT_ID/posts/123" -H "Authorization: Bearer $SA_API_KEY"'}</Code>
        <p>Poll every 10 to 30 seconds until <C>status</C> is no longer <C>queued</C> or <C>publishing</C>. Each target has its own status, <C>externalUrl</C> and <C>errorMessage</C>.</p>
        <Table head={['Post status', 'Meaning']} rows={[
          [<span className="pill pill-mute">queued</span>, 'Waiting, or scheduled for later.'],
          [<span className="pill pill-live">publishing</span>, 'At least one platform is still working.'],
          [<span className="pill pill-good">completed</span>, 'Every supported platform published.'],
          [<span className="pill pill-warn">partial</span>, 'Some published, some failed.'],
          [<span className="pill pill-bad">failed</span>, 'None published.'],
        ]} />
        <p className="text-muted">Temporary errors are retried automatically (up to 3 attempts). After that, retry by hand or fix the cause, often by reconnecting the account.</p>
        <Code label="retry and delete">{'curl -X POST   "$SA_BASE/projects/$SA_PROJECT_ID/posts/123/targets/youtube/retry" -H "Authorization: Bearer $SA_API_KEY"\ncurl -X DELETE "$SA_BASE/projects/$SA_PROJECT_ID/posts/123?remote=true"           -H "Authorization: Bearer $SA_API_KEY"'}</Code>
        <p className="text-muted"><C>?remote=true</C> also deletes the post on the platforms whose API allows it.</p>
      </Section>

      <Section title="All endpoints" id="endpoints">
        <p className="text-muted">Base <C>{base}</C>. Every response has <C>ok: true | false</C>; errors include a readable <C>error</C>.</p>
        <Table head={['Method', 'Path', 'What it does']} rows={[
          ['GET', <C>/me</C>, 'Project for this key, with its connections.'],
          ['GET', <C>/rules</C>, 'Platform limits (caption length, durations). No key needed.'],
          ['GET', <C>/projects/{'{pid}'}</C>, 'Project info and connection status per platform.'],
          ['POST', <C>/projects/{'{pid}'}/media</C>, 'Upload a file (multipart "file") or import { url }.'],
          ['POST', <C>/projects/{'{pid}'}/posts/validate</C>, 'Dry run. Creates nothing.'],
          ['POST', <C>/projects/{'{pid}'}/posts</C>, 'Create a post (now or scheduled).'],
          ['GET', <C>/projects/{'{pid}'}/posts</C>, 'List posts. ?page, ?limit, ?status, ?platform'],
          ['GET', <C>/projects/{'{pid}'}/posts/{'{id}'}</C>, 'One post: per-platform status, URLs, errors, log.'],
          ['POST', <C>/projects/{'{pid}'}/posts/{'{id}'}/targets/{'{platform}'}/retry</C>, 'Retry one failed platform.'],
          ['DELETE', <C>/projects/{'{pid}'}/posts/{'{id}'}</C>, 'Delete from history. ?remote=true deletes on the platforms too.'],
        ]} />
      </Section>

      <Section title="Errors">
        <Table head={['HTTP', 'code', 'Cause and fix']} rows={[
          ['401', <C>missing_api_key</C>, 'No Authorization or X-API-Key header.'],
          ['401', <C>invalid_api_key</C>, 'Wrong, replaced or revoked key. Generate a new one in step 1.'],
          ['403', <C>project_mismatch</C>, 'The key belongs to another project than the one in the URL.'],
          ['403', <C>project_archived</C>, 'Restore the project on the Projects page.'],
          ['400', '–', 'Validation problem. Read error (and results on posts).'],
          ['404', '–', 'Unknown route, or the post is not in this project.'],
          ['413', '–', 'File larger than the upload limit.'],
        ]} />
      </Section>

      <Section title="Full examples">
        <Snippets items={[
          ['Node.js', nodeExample(base, pid)],
          ['Python', pythonExample(base, pid)],
          ['n8n / Zapier', zapExample(cfg?.tunnelBase || 'https://<tunnel-host>/api/v1', pid)],
        ]} />
      </Section>

      <Section title="Security checklist">
        <ul className="list-disc space-y-1 pl-5">
          <li>One key per project. Give each system only the key of the project it should post to.</li>
          <li>If a key leaks, click <b>New key</b>. The old one stops working at once.</li>
          <li>Keep <C>HOST=127.0.0.1</C> unless another machine really needs access.</li>
          <li><C>API_OVER_TUNNEL=true</C> puts the API on the internet. Turn it off when you don&apos;t need it.</li>
        </ul>
        <Notice tone="good">The same guide is in the repo at <C>plans/guides/api.md</C>.</Notice>
      </Section>
    </div>
  )
}

const SUPPORT = {
  linkedin: ['text', 'image', 'video', 'reel'],
  youtube: ['video', 'reel'],
  facebook: ['text', 'image', 'video', 'reel'],
  instagram: ['image', 'video', 'reel'],
}
function SupportMatrix() {
  const types = ['text', 'image', 'video', 'reel']
  return (
    <Table head={['', ...types]} rows={PLATFORMS.map((p) => [
      <span className="flex items-center gap-2"><PlatformIcon platform={p} size="xs" />{PLATFORM_LABEL[p]}</span>,
      ...types.map((t) => (SUPPORT[p].includes(t)
        ? <span className="pill pill-good">Yes</span>
        : <span className="pill pill-mute">No</span>)),
    ])} />
  )
}

const nodeExample = (base, pid) => `// Node.js 18+
const BASE = '${base}'
const PID = process.env.SA_PROJECT_ID ?? '${pid}'
const auth = { Authorization: \`Bearer \${process.env.SA_API_KEY}\` }

async function call(path, init = {}) {
  const res = await fetch(\`\${BASE}/projects/\${PID}\${path}\`, { ...init, headers: { ...auth, ...init.headers } })
  const data = await res.json()
  if (!data.ok) throw new Error(\`\${res.status}: \${data.error}\`)
  return data
}
const json = (body) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

const media = await call('/media', json({ url: 'https://example.com/clip.mp4' }))
const { id } = await call('/posts', json({
  contentType: media.suggestedType,
  caption: 'New video',
  title: 'New video',
  mediaIds: [media.id],
  targets: [{ platform: 'youtube' }, { platform: 'instagram' }],
}))

let post
do {
  await new Promise((r) => setTimeout(r, 15000))
  post = (await call(\`/posts/\${id}\`)).post
} while (['queued', 'publishing'].includes(post.status))
console.log(post.status, post.targets.map((t) => \`\${t.platform}: \${t.externalUrl || t.errorMessage}\`))`

const pythonExample = (base, pid) => `import os, requests

BASE = "${base}"
PID = os.environ.get("SA_PROJECT_ID", "${pid}")
H = {"Authorization": f"Bearer {os.environ['SA_API_KEY']}"}

with open("photo.jpg", "rb") as f:
    media = requests.post(f"{BASE}/projects/{PID}/media", headers=H, files={"file": f}).json()

r = requests.post(f"{BASE}/projects/{PID}/posts", headers=H, json={
    "contentType": "image",
    "caption": "Hello from Python",
    "mediaIds": [media["id"]],
    "targets": [{"platform": "facebook"}, {"platform": "instagram"}],
    "publishNow": False,
    "scheduledAt": "2026-11-25T09:00:00+05:00",
}).json()
print(r)`

const zapExample = (base, pid) => `HTTP Request step 1 (media)
  Method   POST
  URL      ${base}/projects/${pid}/media
  Headers  Authorization: Bearer <your key>   (store as a credential)
           Content-Type: application/json
  Body     { "url": "{{ file URL from the previous step }}" }

HTTP Request step 2 (post)
  Method   POST
  URL      ${base}/projects/${pid}/posts
  Headers  same as above
  Body     {
             "contentType": "{{ step1.suggestedType }}",
             "caption": "{{ caption }}",
             "mediaIds": [{{ step1.id }}],
             "targets": [{ "platform": "instagram" }, { "platform": "facebook" }]
           }`
