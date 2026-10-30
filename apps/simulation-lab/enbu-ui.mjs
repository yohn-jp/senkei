// Separate production-Rust/WASM matrix. Synthetic research UI remains untouched.
const byId = id => document.getElementById(id);
const labels = { '000':'参照', '100':'T', '010':'C', '001':'S',
  '110':'T+C', '101':'T+S', '011':'C+S', '111':'T+C+S',
  R:'Route', V:'Visibility', RV:'Route+Visibility', TCSRV:'T+C+S+Route+Visibility', P:'Planned candidate index', A:'Arithmetic phase dispatcher', F:'Frozen snapshot reuse', FPA:'Frozen+Planned+Arithmetic', G:'Certified fog probes', TCSRVG:'T+C+S+Route+Visibility+Fog', O:'Indexed observations', TCSRVGO:'T+C+S+Route+Visibility+Fog+Observations' };
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
function showRanking(ranking, cases) {
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
  byId('enbu-ranking-note').textContent =
    cases.length + '条件の同重み幾何平均。速度比1.000×が参照。順位は測定ノイズの影響を受け、数%差なら別端末・別実行で再検証が必要です。';
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
      showRanking(report.ranking, report.cases);
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
