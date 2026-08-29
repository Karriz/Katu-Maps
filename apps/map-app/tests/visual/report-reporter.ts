import type { FullResult, Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

type Entry = { title: string; status: string; image?: string; metadata?: Record<string, unknown>; errors: string[] };
export default class VisualReportReporter implements Reporter {
  private entries: Entry[] = [];
  private dir = join(process.cwd(), 'test-results', 'visual-report');
  onBegin() { mkdirSync(join(this.dir, 'screenshots'), { recursive: true }); }
  onTestEnd(test: TestCase, result: TestResult) {
    const shot = result.attachments.find(a => a.name === 'visual-screenshot' && a.path);
    const data = result.attachments.find(a => a.name === 'scenario-metadata' && a.body);
    const image = shot?.path ? basename(shot.path) : undefined;
    if (shot?.path && image && existsSync(shot.path)) copyFileSync(shot.path, join(this.dir, 'screenshots', image));
    let metadata: Record<string, unknown> | undefined;
    try { if (data?.body) metadata = JSON.parse(data.body.toString()); } catch { metadata = { diagnostic: 'Invalid metadata attachment' }; }
    this.entries.push({ title: test.title, status: result.status, image, metadata, errors: result.errors.map(e => e.message ?? String(e)) });
  }
  onEnd(_result: FullResult) {
    const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    const cards = this.entries.map(e => `<article class="card ${esc(e.status)}"><h2>${esc(e.title)}</h2><b>${esc(e.status)}</b>${e.image ? `<a href="screenshots/${encodeURIComponent(e.image)}"><img loading="lazy" src="screenshots/${encodeURIComponent(e.image)}" alt="${esc(e.title)}"></a>` : '<p>No screenshot was produced.</p>'}<dl>${Object.entries(e.metadata ?? {}).map(([k,v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === 'string' ? v : JSON.stringify(v))}</dd>`).join('')}</dl>${e.errors.length ? `<details open><summary>Runtime/test errors</summary><pre>${esc(e.errors.join('\n\n'))}</pre></details>` : ''}</article>`).join('');
    writeFileSync(join(this.dir, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Katu Maps visual report</title><style>body{font:15px system-ui;margin:0;background:#eef2f4;color:#172126}header{padding:24px;background:#173b35;color:white}.gallery{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:18px;padding:18px}.card{background:white;padding:16px;border-radius:12px;box-shadow:0 2px 10px #0001}.card.failed{border:2px solid #bd2525}h2{font-size:18px}img{display:block;width:100%;margin:12px 0;border:1px solid #ccd5d8}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 12px;font-size:13px}dt{font-weight:700}dd{margin:0;overflow-wrap:anywhere}pre{white-space:pre-wrap;color:#8b1616}</style></head><body><header><h1>Katu Maps visual review</h1><p>Scenario screenshots and diagnostics. SwiftShader is not a physical-device performance measurement.</p></header><main class="gallery">${cards}</main></body></html>`);
  }
}
