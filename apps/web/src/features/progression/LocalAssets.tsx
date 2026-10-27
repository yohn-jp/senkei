import { useState } from "react";
import { EquipmentRepository, type EquipmentInstance } from "../equipment/repository";

/** Read/recovery UI only: no definition or Hero ownership producer is configured. */
export function LocalAssets() {
  const [playerId, setPlayerId] = useState("");
  const [items, setItems] = useState<EquipmentInstance[] | null>(null);
  const [query, setQuery] = useState("");
  const [archive, setArchive] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const perform = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); } catch (error) { setStatus(`Storage operation failed: ${error instanceof Error ? error.message : String(error)}. Retry the operation or export available data before recovery.`); }
    finally { setBusy(false); }
  };
  const repository = () => new EquipmentRepository();
  return <details><summary>Local trial equipment</summary>
    <p>Local trial assets are separate from official ownership. Official assets, rewards, draws and market: not configured. Battle results do not issue Libra.</p>
    <label>Local Player identity <input value={playerId} onChange={event => { setPlayerId(event.target.value); setItems(null); setArchive(""); setStatus(""); }} disabled={busy}/></label>
    <button type="button" disabled={busy || !playerId.trim()} onClick={() => void perform(async () => { setItems(await repository().list(playerId)); setStatus("Equipment loaded."); })}>Load / retry</button>
    <label>Search owned instances <input value={query} onChange={event => setQuery(event.target.value)}/></label>
    {items && (items.length === 0 ? <p>No local equipment owned by this Player.</p> : items.filter(item => `${item.instanceId} ${item.definition.id}`.includes(query)).length === 0 ? <p>No matching equipment.</p> : <ul>{items.filter(item => `${item.instanceId} ${item.definition.id}`.includes(query)).map(item => <li key={item.instanceId}><details><summary>{item.definition.id} · {item.instanceId}</summary><p>Authority: local · Definition version: {item.definition.version} · Digest: {item.definition.digest} · Effect reference: {item.definition.effectRef}</p><p>Equipment preview unavailable: durable Hero ownership and approved combat effects are not configured.</p></details></li>)}</ul>)}
    <button type="button" disabled={busy || !playerId.trim()} onClick={() => void perform(async () => { setArchive(JSON.stringify(await repository().export(playerId), null, 2)); setStatus("Local archive prepared. Copy it to retain a backup."); })}>Prepare export</button>
    <label>Local equipment recovery archive <textarea value={archive} onChange={event => setArchive(event.target.value)} disabled={busy}/></label>
    <p>Recovery validates schema, Player identity and approved definition references. No effect definitions are configured; unapproved assets are rejected.</p>
    <button type="button" disabled={busy || !playerId.trim() || !archive.trim()} onClick={() => void perform(async () => { await repository().import(playerId, JSON.parse(archive)); setStatus("Local recovery committed. Reload to inspect recovered equipment."); setItems(null); })}>Validate and recover local archive</button>
    <p role="status">{status}</p>
  </details>;
}
