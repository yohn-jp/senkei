// Separate production-Rust/WASM matrix. Synthetic research UI remains untouched.
const byId = id => document.getElementById(id);
const labels = { '000':'参照', '100':'T', '010':'C', '001':'S',
  '110':'T+C', '101':'T+S', '011':'C+S', '111':'T+C+S',
  R:'Route', V:'Visibility', RV:'Route+Visibility', TCSRV:'T+C+S+Route+Visibility', P:'Planned candidate index', A:'Arithmetic phase dispatcher', F:'Frozen snapshot reuse', FPA:'Frozen+Planned+Arithmetic', G:'Certified fog probes', TCSRVG:'Old production T+C+S+Route+Visibility+Fog', Y:'Replay visibility fusion', TCSRVGY:'Production TCSRVG+Replay fusion', O:'Indexed observations', TCSRVGO:'T+C+S+Route+Visibility+Fog+Observations', I:'In-place movement', B:'Combat visibility frontier', TCSRVIB:'TCSRV+In-place+Frontier', H:'Hybrid: P/A/Spatial/Frozen/Observation/Scheduler/Movement/Passive', TCSRVH:'TCSRV+Hybrid execution', S:'Temporal frontier and event scheduler', TCSRVS:'TCSRV+Temporal frontiers', TCSRVHS:'TCSRV+Hybrid (historical redundant S mask)', W:'Certified Movement Active Set', TCSRVGW:'Current production TCSRVG + MovementWindow', X:'Graph-local combat candidate index', TCSRVGX:'Current production TCSRVG + spatial combat index', TCSRVGAS:'Current production TCSRVG + Arithmetic periodic candidate windows + Scheduler', TCSRVGH:'Production TCSRVG + full Hybrid (candidate)' };
let worker = null;
let report = null;

function status(message) { byId('enbu-status').textContent = message; }
function setRunning(running) {
  byId('enbu-run').disabled = running;
  byId('enbu-cancel').disabled = !running;
  byId('enbu-export').disabled = running || !report;
  byId('enbu-download').disabled = running || !report;
}
function resetResults() {
  report = null;
  byId('enbu-results').replaceChildren();
  byId('enbu-ranking').replaceChildren();
  byId('enbu-effects').replaceChildren();
  byId('enbu-report').value = '';
  byId('enbu-ranking-note').textContent =
    '各ケースの中央値を参照版と比較し、すべてのケースを確認した構成だけ順位付けします。';
}
function addRow(row) {
  const values = [
    row.ticks, row.variant + ' · ' + labels[row.variant],
    row.stats.median_ms.toFixed(2), row.wasm_dispatch_ms.toFixed(2),
    row.stats.p95_ms.toFixed(2), row.speedup.median_ratio.toFixed(3) + '×',
    row.incumbent_speedup ? row.incumbent_speedup.median_ratio.toFixed(3) + '×' : '—',
    row.production_speedup ? row.production_speedup.median_ratio.toFixed(3) + '×' : '—',
    (row.wasm_bytes / 1024).toFixed(0), (row.memory_bytes / 1048576).toFixed(1),
    row.verified ? 'PASS' : 'FAIL',
  ];
  const tr = document.createElement('tr');
  for (const value of values) {
    const td = document.createElement('td');
    td.textContent = String(value);
    tr.append(td);
  }
  byId('enbu-results').append(tr);
}
function showRanking(ranking, cases, incumbentRanking = [], productionRanking = []) {
  const list = byId('enbu-ranking');
  list.replaceChildren();
  for (const ranked of ranking) {
    const li = document.createElement('li');
    const ratio = ranked.aggregate_ratio.toFixed(3);
    const worst = ranked.worst_ratio.toFixed(3);
    li.textContent = ranked.id + ' (' + labels[ranked.id] + ') · ' + ratio +
      '× 幾何平均 · 最悪ケース ' + worst + '× · 悪化 ' +
      ranked.regressed_cases + '/' + ranked.cases + '件 · ' +
      (ranked.bytes / 1024).toFixed(0) + ' KiB';
    list.append(li);
  }
  const experiments = ['TCSRVGY', 'TCSRVGW', 'TCSRVGX', 'TCSRVGAS', 'TCSRVGH'].map(id =>
    incumbentRanking.find(candidate => candidate.id === id)).filter(Boolean);
  const compared = experiments.map(candidate =>
    candidate.id + ': 旧本番比 ' + candidate.aggregate_ratio.toFixed(3) +
    '× / 最悪 ' + candidate.worst_ratio.toFixed(3) + '×').join(' · ');
  const current = productionRanking?.find(candidate => candidate.id === 'TCSRVGH');
  const productionComparison = current
    ? '現行本番TCSRVGY比：Hybrid ' + current.aggregate_ratio.toFixed(3) +
      '× / 最悪 ' + current.worst_ratio.toFixed(3) + '×。'
    : '';
  byId('enbu-ranking-note').textContent =
    cases.length + '条件の同重み幾何平均。順位はReference 000比。' +
    (compared ? '旧本番TCSRVGとの比較：' + compared + '。' : '') +
    productionComparison + '数%差は測定ノイズを含むため別端末で再測定が必要です。';
}
function showEffects(effects) {
  const list = byId('enbu-effects');
  list.replaceChildren();
  if (!effects?.length) {
    const item = document.createElement('li');
    item.textContent = '個別寄与度には全8構成の比較が必要です。';
    list.append(item);
    return;
  }
  for (const effect of effects) {
    const item = document.createElement('li');
    item.textContent = effect.id + ': 平均 ' + effect.geometric_mean_ratio.toFixed(3) +
      '× · 最悪 ' + effect.worst_ratio.toFixed(3) + '× · 悪化 ' +
      effect.regressions + '/' + effect.comparisons + '比較';
    list.append(item);
  }
}
function finish(message) {
  if (worker) {
    worker.terminate();
    worker = null;
  }
  setRunning(false);
  status(message);
}
function run(event) {
  event.preventDefault();
  if (worker) return;
  resetResults();
  setRunning(true);
  status('本番Enbu WASMを準備しています');
  worker = new Worker(new URL('./enbu-worker.mjs', import.meta.url), {type:'module'});
  worker.addEventListener('error', event => {
    resetResults();
    finish('WASM Workerでエラー: ' + event.message);
  });
  worker.addEventListener('message', ({data}) => {
    if (data.type === 'status') status(data.text);
    if (data.type === 'row') addRow(data.row);
    if (data.type === 'complete') {
      report = data.report;
      byId('enbu-report').value = JSON.stringify(report, null, 2);
      showRanking(report.ranking, report.cases, report.incumbent_ranking,
        report.production_ranking);
      showEffects(report.effects);
      finish('検証成功: ' + report.cases.length +
        '条件・' + Object.keys(report.loads).length +
        '構成がNative Rustの応答全文と一致しました');
    }
    if (data.type === 'error') {
      resetResults();
      finish('検証失敗。計測値は無効です: ' + data.message);
    }
  });
  worker.postMessage({
    type:'run', caseId: byId('enbu-case').value,
    variantId: byId('enbu-variant').value,
    samples: Number(byId('enbu-samples').value),
  });
}
// Only offer binaries that are actually present in the immutable published manifest.
// Ordinary releases contain the verified reference/incumbent/production triad.
// The complete 36-way portfolio is available in explicitly requested research runs.
async function loadPublishedVariants() {
  const runButton = byId('enbu-run');
  runButton.disabled = true;
  try {
    const [manifestResponse, buildResponse] = await Promise.all([
      fetch(new URL('./enbu-variants.json', import.meta.url), {cache:'no-store'}),
      fetch(new URL('./build.json', import.meta.url), {cache:'no-store'}),
    ]);
    if (!manifestResponse.ok || !buildResponse.ok) throw Error('配布マニフェストを取得できません');
    const [manifest, build] = await Promise.all([
      manifestResponse.json(), buildResponse.json(),
    ]);
    if (manifest.revision !== build.revision ||
        ![3, 36].includes(manifest.variants?.length)) {
      throw Error('WASMと公開revisionが一致しません');
    }
    const available = new Set(manifest.variants.map(variant => variant.id));
    for (const option of [...byId('enbu-variant').options]) {
      if (option.value !== 'all' && !available.has(option.value)) option.remove();
    }
    const all = byId('enbu-variant').querySelector('option[value="all"]');
    all.textContent = '全公開構成（' + available.size + '種類）';
    if (!available.has(byId('enbu-variant').value)) {
      byId('enbu-variant').value = 'TCSRVGY';
    }
    status('公開revision ' + build.revision.slice(0, 8) +
      ' · ' + available.size + '構成（Native Rust全文一致で検証）');
    runButton.disabled = false;
  } catch (error) {
    status('公開WASMの取得に失敗: ' + error.message);
  }
}
void loadPublishedVariants();
byId('enbu-form').addEventListener('submit', run);
byId('enbu-cancel').addEventListener('click', () => {
  if (!worker) return;
  resetResults();
  finish('中止しました。途中結果を採用していません。');
});
byId('enbu-export').addEventListener('click', async () => {
  if (!report) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
    status('比較レポートをコピーしました');
  } catch {
    byId('enbu-report').focus();
    byId('enbu-report').select();
    status('コピーが拒否されました。レポートを選択しています');
  }
});
byId('enbu-download').addEventListener('click', () => {
  if (!report) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)],
    {type:'application/json'}));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'senkei-enbu-wasm-matrix-' + report.source_revision.slice(0, 8) + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
