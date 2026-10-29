// Independent production Enbu lane. The 11-method synthetic lab remains unchanged.
const byId = id => document.getElementById(id);
let worker;
let report;
function message(text) { byId('enbu-status').textContent = text; }
function run(event) {
  event.preventDefault();
  if (worker) return;
  byId('enbu-results').replaceChildren();
  byId('enbu-report').value = '';
  byId('enbu-export').disabled = true;
  byId('enbu-run').disabled = true;
  message('本番WASMを準備しています…');
  worker = new Worker(new URL('./enbu-worker.mjs', import.meta.url), {type: 'module'});
  function finish(text) {
    message(text);
    byId('enbu-run').disabled = false;
    worker?.terminate();
    worker = null;
  }
  worker.addEventListener('error', event => finish('WASM Workerエラー: ' + event.message));
  worker.addEventListener('message', ({data}) => {
    if (data.type === 'status') message(data.text);
    if (data.type === 'row') {
      const tr = document.createElement('tr');
      for (const value of [data.row.ticks, data.row.reference.median_ms.toFixed(3),
        data.row.optimized.median_ms.toFixed(3), data.row.speedup.toFixed(2) + '×', 'PASS']) {
        const td = document.createElement('td'); td.textContent = String(value); tr.appendChild(td);
      }
      byId('enbu-results').appendChild(tr);
      message(`本番Enbu: ${data.row.ticks} Tick の参照/最適化WASM一致を確認`);
    }
    if (data.type === 'complete') {
      report = data.report;
      byId('enbu-report').value = JSON.stringify(report, null, 2);
      byId('enbu-export').disabled = false;
      finish('完了: 全ケースのネイティブRust / WASM出力が完全一致しました');
    }
    if (data.type === 'error') {
      report = null;
      byId('enbu-results').replaceChildren();
      finish('検証失敗（計測値は不採用）: ' + data.message);
    }
  });
  worker.postMessage({type: 'run', caseId: byId('enbu-case').value,
    samples: Number(byId('enbu-samples').value)});
}
byId('enbu-form').addEventListener('submit', run);
byId('enbu-export').addEventListener('click', async () => {
  if (!report) return;
  const content = JSON.stringify(report, null, 2);
  try {
    await navigator.clipboard.writeText(content);
    message('WASM測定レポートをコピーしました');
  } catch {
    byId('enbu-report').focus();
    byId('enbu-report').select();
    message('コピーが拒否されました。レポートを選択しています');
  }
});
