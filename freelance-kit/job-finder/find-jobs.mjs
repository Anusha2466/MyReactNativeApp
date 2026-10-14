#!/usr/bin/env node
// On-demand finder for part-time / contract / freelance Android & React Native posts.
// Runs only when you trigger it, needs no dependencies (Node 18+), and touches nothing outside this folder.
//
//   node find-jobs.mjs           part-time / contract / freelance matches only
//   node find-jobs.mjs --all     every Android / React Native match, part-time ones flagged
//   node find-jobs.mjs --new     only posts you have not seen on a previous run
//   node find-jobs.mjs --open    open the HTML report when done

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const SHOW_ALL = args.has('--all');
const ONLY_NEW = args.has('--new');
const OPEN = args.has('--open');

const config = JSON.parse(await readFile(join(HERE, 'config.json'), 'utf8'));
const SEEN_FILE = join(HERE, '.seen.json');
const UA = 'Mozilla/5.0 (personal part-time job finder)';

// ---------- helpers ----------

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Word boundaries only where the keyword edge is a word char, so "/hr" still matches but "expo" won't hit "export".
const toRegex = (words) =>
  new RegExp(
    words
      .map((w) => `${/^\w/.test(w) ? '\\b' : ''}${escapeRe(w)}${/\w$/.test(w) ? '\\b' : ''}`)
      .join('|'),
    'gi'
  );
const SKILL_RE = toRegex(config.skills);
const PART_RE = toRegex(config.partTimeSignals);
const MOBILE_ROLE_RE = /\bmobile\b.*\b(developer|engineer|dev)\b|\b(app|mobile) (developer|engineer)\b/i;
const EXCLUDE_RE = config.excludeIfTitleHas.length ? toRegex(config.excludeIfTitleHas) : null;

const decode = (s = '') =>
  s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
const stripHtml = (s = '') => decode(decode(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uniq = (arr) => [...new Set(arr.map((m) => m.toLowerCase()))];

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Every source returns: { id, source, sourceUrl, title, company, url, date, type, location, salary, text }

const sources = {
  async Remotive() {
    const out = [];
    for (const q of ['react native', 'android', 'kotlin']) {
      const j = await getJson(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}`);
      for (const x of j.jobs || []) {
        out.push({
          id: `remotive-${x.id}`, source: 'Remotive', sourceUrl: 'https://remotive.com',
          title: x.title, company: x.company_name, url: x.url, date: x.publication_date,
          type: (x.job_type || '').replace('_', '-'), location: x.candidate_required_location,
          salary: x.salary, text: stripHtml(x.description),
        });
      }
    }
    return out;
  },

  async 'Remote OK'() {
    const out = [];
    for (const tag of ['react-native', 'android']) {
      const j = await getJson(`https://remoteok.com/api?tag=${tag}`);
      for (const x of j.filter((r) => r.id)) {
        const salary = x.salary_min ? `$${x.salary_min}–$${x.salary_max}/yr` : '';
        out.push({
          id: `remoteok-${x.id}`, source: 'Remote OK', sourceUrl: 'https://remoteok.com',
          title: x.position, company: x.company, url: x.url, date: x.date,
          type: '', location: x.location, salary, text: `${(x.tags || []).join(' ')} ${stripHtml(x.description)}`,
        });
      }
    }
    return out;
  },

  async Jobicy() {
    const out = [];
    for (const tag of ['react-native', 'android', 'mobile', 'kotlin']) {
      const j = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=50&tag=${tag}`);
      for (const x of j.jobs || []) {
        const salary = x.salaryMin ? `${x.salaryCurrency || ''} ${x.salaryMin}–${x.salaryMax} ${x.salaryPeriod || ''}` : '';
        out.push({
          id: `jobicy-${x.id}`, source: 'Jobicy', sourceUrl: 'https://jobicy.com',
          title: x.jobTitle, company: x.companyName, url: x.url, date: x.pubDate,
          type: [].concat(x.jobType || []).join(', '), location: x.jobGeo, salary: salary.trim(),
          text: stripHtml(x.jobDescription || x.jobExcerpt),
        });
      }
    }
    return out;
  },

  async 'We Work Remotely'() {
    const xml = await getText('https://weworkremotely.com/categories/remote-programming-jobs.rss');
    const tag = (item, name) => (item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '';
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item]) => {
      const [company, ...rest] = decode(tag(item, 'title')).split(': ');
      const link = tag(item, 'guid') || tag(item, 'link');
      return {
        id: `wwr-${link}`, source: 'We Work Remotely', sourceUrl: 'https://weworkremotely.com',
        title: rest.join(': ') || company, company: rest.length ? company : '', url: link,
        date: new Date(tag(item, 'pubDate')).toISOString(), type: tag(item, 'type'),
        location: decode(tag(item, 'region')), salary: '', text: stripHtml(tag(item, 'description')),
      };
    });
  },

  // Monthly "Who is hiring?" and "Freelancer? Seeking freelancer?" threads.
  async 'Hacker News'() {
    const [hiring, freelance] = await Promise.all([
      getJson('https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&query=%22Who%20is%20hiring%22&hitsPerPage=5'),
      getJson('https://hn.algolia.com/api/v1/search_by_date?tags=story&query=%22Freelancer%3F%20Seeking%20freelancer%3F%22&hitsPerPage=5'),
    ]);
    const wanted = [...hiring.hits, ...freelance.hits].filter((h) =>
      /^Ask HN: (Who is hiring\?|Freelancer\? Seeking freelancer\?)/.test(h.title || '')
    );
    const latest = new Map(); // newest thread of each kind
    for (const h of wanted) {
      const kind = h.title.startsWith('Ask HN: Who') ? 'hiring' : 'freelance';
      if (!latest.has(kind) || latest.get(kind).created_at_i < h.created_at_i) latest.set(kind, h);
    }
    const out = new Map();
    for (const [kind, story] of latest) {
      for (const q of ['android', 'react native', 'kotlin']) {
        const j = await getJson(
          `https://hn.algolia.com/api/v1/search?tags=comment,story_${story.objectID}&query=${encodeURIComponent(q)}&hitsPerPage=100`
        );
        for (const c of j.hits) {
          if (c.parent_id !== Number(story.objectID)) continue; // top-level posts only, not replies
          const text = stripHtml(c.comment_text);
          if (kind === 'freelance' && !/seeking freelancer/i.test(text)) continue; // skip people offering themselves
          if (/^location:.*willing to relocate/i.test(text)) continue; // a candidate's post, not a job
          out.set(c.objectID, {
            id: `hn-${c.objectID}`, source: `Hacker News · ${kind === 'hiring' ? 'Who is hiring' : 'Seeking freelancer'}`,
            sourceUrl: `https://news.ycombinator.com/item?id=${story.objectID}`,
            title: text.split(/\s\|\s|\.\s/)[0].slice(0, 120), company: c.author,
            url: `https://news.ycombinator.com/item?id=${c.objectID}`, date: c.created_at,
            type: kind === 'freelance' ? 'freelance' : '', location: '', salary: '', text,
          });
        }
      }
    }
    return [...out.values()];
  },
};

// Boards without a free API: opened as pre-filled searches from the report.
const manualSearches = [
  ['LinkedIn · part-time/contract, remote', 'https://www.linkedin.com/jobs/search/?keywords=react%20native%20android&f_JT=P%2CC&f_WT=2&sortBy=DD'],
  ['Upwork · hourly React Native', 'https://www.upwork.com/nx/search/jobs/?q=react%20native&t=0&sort=recency'],
  ['Upwork · hourly Android Kotlin', 'https://www.upwork.com/nx/search/jobs/?q=android%20kotlin&t=0&sort=recency'],
  ['Naukri · React Native part-time', 'https://www.naukri.com/react-native-part-time-jobs'],
  ['Indeed India · React Native part-time', 'https://in.indeed.com/jobs?q=react+native+part+time&sort=date'],
  ['Freelancer.com · React Native', 'https://www.freelancer.com/jobs/react-native/'],
  ['Wellfound · React Native', 'https://wellfound.com/role/r/react-native-developer'],
  ['Reddit r/forhire · [Hiring] React Native', 'https://www.reddit.com/r/forhire/search/?q=hiring%20react%20native&restrict_sr=1&sort=new'],
  ['Reddit r/reactnative · jobs', 'https://www.reddit.com/r/reactnative/search/?q=hiring&restrict_sr=1&sort=new'],
];

// ---------- run ----------

console.log('Searching for part-time Android / React Native posts…\n');
const results = await Promise.allSettled(Object.entries(sources).map(async ([name, fn]) => [name, await fn()]));

const status = [];
let all = [];
for (const [i, r] of results.entries()) {
  const name = Object.keys(sources)[i];
  if (r.status === 'fulfilled') {
    status.push({ name, ok: true, count: r.value[1].length });
    all.push(...r.value[1]);
  } else {
    status.push({ name, ok: false, error: r.reason?.message || String(r.reason) });
  }
}

const cutoff = Date.now() - config.maxAgeDays * 86400000;
const seen = existsSync(SEEN_FILE) ? new Set(JSON.parse(await readFile(SEEN_FILE, 'utf8'))) : new Set();
const byId = new Map();

for (const job of all) {
  if (byId.has(job.id)) continue;
  const time = Date.parse(job.date);
  if (time && time < cutoff) continue;
  if (EXCLUDE_RE && EXCLUDE_RE.test(job.title)) { EXCLUDE_RE.lastIndex = 0; continue; }
  const haystack = `${job.title} ${job.type} ${job.text}`;
  const skills = uniq(haystack.match(SKILL_RE) || []);
  if (!skills.length) continue; // must actually mention Android / React Native
  // ...and be a mobile dev role, not e.g. a data role that mentions "Android" once in passing.
  // HN posts have no real title, so for them the first chunk of the post stands in.
  const roleText = job.source.startsWith('Hacker News') ? job.text.slice(0, 400) : job.title;
  const skillInRole = SKILL_RE.test(roleText); SKILL_RE.lastIndex = 0;
  if (!skillInRole && !(MOBILE_ROLE_RE.test(roleText) && skills.length >= 2)) continue;
  const partTime = uniq(haystack.match(PART_RE) || []);
  if (!SHOW_ALL && !partTime.length) continue;
  const isNew = !seen.has(job.id);
  if (ONLY_NEW && !isNew) continue;
  // Rank: part-time signals first, then React Native/Android in the title, then recency.
  const score = partTime.length * 10 + (skillInRole ? 5 : 0) + skills.length;
  byId.set(job.id, { ...job, skills, partTime, isNew, score, time: time || 0 });
}

const jobs = [...byId.values()].sort((a, b) => b.score - a.score || b.time - a.time);

// remember everything we showed, so --new works next time
for (const j of jobs) seen.add(j.id);
await writeFile(SEEN_FILE, JSON.stringify([...seen]));

// ---------- terminal summary ----------

for (const s of status) console.log(`  ${s.ok ? '✔' : '✖'} ${s.name.padEnd(18)} ${s.ok ? `${s.count} fetched` : `failed: ${s.error}`}`);
console.log(`\n${jobs.length} matching post(s)${SHOW_ALL ? '' : ' with part-time / contract / freelance signals'}${ONLY_NEW ? ' (new only)' : ''}:\n`);
for (const j of jobs.slice(0, 15)) {
  console.log(`${j.isNew ? '[NEW] ' : ''}${j.title} — ${j.company || ''}`);
  console.log(`      ${j.source} · ${j.partTime.join(', ') || 'no part-time signal'} · ${j.url}`);
}
if (jobs.length > 15) console.log(`…and ${jobs.length - 15} more in the HTML report.`);

// ---------- HTML report ----------

const fmtDate = (t) => (t ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const card = (j) => {
  const snippet = j.text.slice(0, 320);
  return `<article class="job">
  <div class="top">
    <a class="title" href="${esc(j.url)}" target="_blank" rel="noopener">${esc(j.title)}</a>
    ${j.isNew ? '<span class="new">new</span>' : ''}
  </div>
  <div class="meta">${esc(j.company || '')}${j.location ? ' · ' + esc(j.location) : ''}${j.salary ? ' · ' + esc(j.salary) : ''} · ${fmtDate(j.time)}</div>
  <div class="chips">
    ${j.partTime.map((p) => `<span class="chip pt">${esc(p)}</span>`).join('')}
    ${j.skills.map((s) => `<span class="chip">${esc(s)}</span>`).join('')}
  </div>
  <p>${esc(snippet)}${j.text.length > 320 ? '…' : ''}</p>
  <div class="src">via <a href="${esc(j.sourceUrl)}" target="_blank" rel="noopener">${esc(j.source)}</a></div>
</article>`;
};

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Part-time Mobile Jobs</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--ink:#1c1c1a;--muted:#6b6b66;--line:#e4e3de;--accent:#0f766e;--accent-soft:#d9f0ec}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--card:#1e1e1c;--ink:#ecebe6;--muted:#9c9b95;--line:#2f2f2c;--accent:#5eead4;--accent-soft:#163b37}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:860px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:24px;margin:0 0 4px}h2{font-size:16px;margin:32px 0 12px}.sub{color:var(--muted);margin:0 0 20px}
.status{display:flex;flex-wrap:wrap;gap:8px;font-size:13px;color:var(--muted)}.status span{border:1px solid var(--line);border-radius:999px;padding:2px 10px}
.status .bad{color:#b45309}
.job{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:12px}
.top{display:flex;gap:8px;align-items:baseline}.title{font-weight:600;color:var(--ink);text-decoration:none}.title:hover{color:var(--accent)}
.new{font-size:11px;background:var(--accent);color:var(--bg);border-radius:4px;padding:0 6px;text-transform:uppercase}
.meta,.src{color:var(--muted);font-size:13px}.src a{color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}.chip{font-size:12px;border:1px solid var(--line);border-radius:999px;padding:1px 8px}
.chip.pt{background:var(--accent-soft);border-color:transparent;color:var(--accent)}
p{margin:6px 0;color:var(--muted);font-size:14px;overflow-wrap:anywhere}
.links{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px}
.links a{display:block;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--ink);text-decoration:none;font-size:14px}
.links a:hover{border-color:var(--accent)}
.empty{color:var(--muted)}
</style></head><body><main>
<h1>Part-time Android &amp; React Native posts</h1>
<p class="sub">${jobs.length} match${jobs.length === 1 ? '' : 'es'} · ${SHOW_ALL ? 'all matches' : 'part-time / contract / freelance only'}${ONLY_NEW ? ' · new only' : ''} · generated ${new Date().toLocaleString('en-IN')}</p>
<div class="status">${status.map((s) => `<span class="${s.ok ? '' : 'bad'}">${esc(s.name)}: ${s.ok ? s.count : 'failed'}</span>`).join('')}</div>
<h2>Matches</h2>
${jobs.length ? jobs.map(card).join('\n') : '<p class="empty">Nothing matched this time. Try <code>npm run jobs:all</code> or the searches below.</p>'}
<h2>Search these boards too (no public API)</h2>
<div class="links">${manualSearches.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label)} ↗</a>`).join('')}</div>
</main></body></html>`;

await mkdir(join(HERE, 'output'), { recursive: true });
const reportPath = join(HERE, 'output', `jobs-${new Date().toISOString().slice(0, 10)}.html`);
await writeFile(reportPath, html);
console.log(`\nReport: ${reportPath}`);

if (OPEN) {
  const cmd = process.platform === 'win32' ? `start "" "${reportPath}"` : process.platform === 'darwin' ? `open "${reportPath}"` : `xdg-open "${reportPath}"`;
  exec(cmd);
}
