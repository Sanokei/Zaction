import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { MEMBERS, type Actions, type AppState, type Choice, type DemoSnapshot, type LocalState, type Operation, type Receipt, type View } from './model';
import { emptyLocal, loadLocal, updateLocal } from './store';

const root = createRoot(document.getElementById('root')!);
let local: LocalState = emptyLocal();
const views: View[] = ['home', 'action', 'proposal', 'progress', 'learn'];
function currentView(): View {
  const hash = location.hash.slice(1) as View;
  return views.includes(hash) ? hash : 'home';
}
let runtime: Pick<AppState, 'view' | 'busy' | 'connectivity' | 'error' | 'notice' | 'installAvailable'> = {
  view: currentView(), busy: false, connectivity: 'connecting', error: null, notice: null, installAvailable: false,
};
let writes: Promise<void> = Promise.resolve();
let syncing = false;
let resync = false;
let initialized = false;
let bootstrapped = false;
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let installPrompt: InstallPrompt | null = null;

function render() {
  root.render(bootstrapped
    ? <React.StrictMode><App state={{ ...local, ...runtime }} actions={actions} /></React.StrictMode>
    : <main className="boot-screen" role="status"><strong>zaction.</strong><p>Opening your saved work…</p></main>);
}
function updateRuntime(patch: Partial<typeof runtime>) { runtime = { ...runtime, ...patch }; render(); }
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something interrupted this action.'; }

async function mutate(update: (previous: LocalState) => LocalState): Promise<boolean> {
  if (!initialized) {
    updateRuntime({ error: 'Local storage has not opened safely. Existing data is preserved. Retry to reopen storage before saving.' });
    return false;
  }
  let success = false;
  const operation = writes.then(async () => {
    local = await updateLocal(update);
    success = true;
    render();
  });
  writes = operation.catch(error => {
    updateRuntime({ error: `Could not save on this device. Keep your text open and retry. ${errorMessage(error)}` });
  });
  await writes;
  return success;
}

function validateSnapshot(value: unknown): DemoSnapshot {
  const candidate = value as DemoSnapshot;
  if (!candidate || candidate.schemaVersion !== 1 || typeof candidate.roomId !== 'string' || !Array.isArray(candidate.ballots) || !Array.isArray(candidate.contributions) || !Array.isArray(candidate.minutes) || !Array.isArray(candidate.completedTasks) || !['open', 'adopted', 'not-adopted', 'no-quorum'].includes(candidate.outcome)) {
    throw new Error('The demo room returned an unsupported record. Local work is preserved.');
  }
  return candidate;
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`The demo room could not complete the request (${response.status}).`);
  return response.json();
}

const acceptedMessages: Record<Operation['type'], string> = {
  contribute: 'Your question is now shared with the demo group.', vote: 'Your ballot was accepted by the demo room.',
  close: 'The demo vote is closed. Review its outcome and publish the minutes.',
  minutes: 'Your decision notes are published. Earlier versions remain available.',
  'complete-task': 'Your self-reported task completion is now shared with the demo group.',
};

async function synchronize(): Promise<void> {
  if (!initialized) return;
  if (syncing) { resync = true; return; }
  if (!navigator.onLine) { updateRuntime({ connectivity: 'offline' }); return; }
  syncing = true;
  try {
    const snapshot = validateSnapshot(await request('/api/state'));
    if (!await mutate(previous => ({ ...previous, snapshot, lastSync: new Date().toISOString() }))) return;
    updateRuntime({ connectivity: 'online' });
    for (const pending of [...local.pending]) {
      if (!navigator.onLine) { updateRuntime({ connectivity: 'offline' }); break; }
      const result = await request('/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
      const nextSnapshot = validateSnapshot(result.snapshot);
      const receipt: Receipt = result.receipt;
      if (!receipt || receipt.id !== pending.id || typeof receipt.accepted !== 'boolean') throw new Error('The demo room returned an invalid receipt. Your pending action was preserved.');
      const saved = await mutate(previous => ({
        ...previous, snapshot: nextSnapshot, lastSync: new Date().toISOString(),
        pending: previous.pending.filter(item => item.id !== pending.id),
        receipts: [...previous.receipts.filter(item => item.id !== receipt.id), { ...receipt, operation: pending }].slice(-100),
        draft: !receipt.accepted && pending.type === 'contribute' && !previous.draft ? pending.text ?? '' : previous.draft,
      }));
      if (!saved) break;
      updateRuntime(receipt.accepted ? { notice: acceptedMessages[pending.type], error: null } : { error: `Not accepted: ${receipt.reason}. Your original action is retained in your submission history.`, notice: null });
    }
  } catch {
    updateRuntime({ connectivity: navigator.onLine ? 'unavailable' : 'offline' });
  } finally {
    syncing = false;
    if (resync) { resync = false; void synchronize(); }
  }
}

async function enqueue(type: Operation['type'], extra: Partial<Operation> = {}) {
  if (!local.memberId) { updateRuntime({ error: 'Choose a synthetic demo profile before sharing or voting.' }); return; }
  if (!local.snapshot) { updateRuntime({ error: 'Connect once to load the demo room before submitting an action.' }); return; }
  if (type === 'vote' && local.pending.some(item => item.type === 'vote' && item.memberId === local.memberId)) {
    updateRuntime({ notice: 'Your ballot is already saved on this device and awaiting acceptance.' }); return;
  }
  const operation: Operation = {
    id: crypto.randomUUID(), type, memberId: local.memberId, roomId: local.snapshot.roomId,
    proposalRevision: local.snapshot.proposalRevision, rulesVersion: local.snapshot.rulesVersion,
    membershipVersion: local.snapshot.membershipVersion, ...extra,
  };
  updateRuntime({ busy: true, error: null });
  const saved = await mutate(previous => ({ ...previous, pending: [...previous.pending, operation] }));
  updateRuntime({ busy: false, ...(saved ? { notice: 'Saved on this device — awaiting group acceptance.' } : {}) });
  if (saved) void synchronize();
}

const actions: Actions = {
  navigate(view) { location.hash = view; updateRuntime({ view }); window.scrollTo({ top: 0 }); },
  async join(memberId) {
    if (!MEMBERS.some(member => member.id === memberId)) return;
    if (await mutate(previous => ({ ...previous, memberId }))) updateRuntime({ error: null, notice: `You’re using ${MEMBERS.find(member => member.id === memberId)!.name}, a synthetic demo profile.` });
  },
  async saveDraft(text) {
    if (text.length > 2000) { updateRuntime({ error: 'Keep your contribution within 2,000 characters.' }); return false; }
    const saved = await mutate(previous => ({ ...previous, draft: text }));
    if (saved) updateRuntime({ notice: 'Draft saved on this device. Nothing has been published.', error: null });
    return saved;
  },
  async publishContribution(text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000) { updateRuntime({ error: 'Write a question or correction of 1–2,000 characters.' }); return; }
    await enqueue('contribute', { text: trimmed });
  },
  async castVote(choice: Choice) { await enqueue('vote', { choice }); },
  async closeVote() { await enqueue('close'); },
  async publishMinutes(text) {
    if (!text.trim() || text.trim().length > 2000) { updateRuntime({ error: 'Write decision notes of 1–2,000 characters.' }); return; }
    await enqueue('minutes', { text: text.trim() });
  },
  async toggleProgress(key) {
    if (await mutate(previous => ({ ...previous, progress: { ...previous.progress, [key]: !previous.progress[key] } }))) {
      updateRuntime({ notice: 'Personal progress saved privately on this device. Your voting weight stays the same.', error: null });
    }
  },
  async completeTask(taskId) { await enqueue('complete-task', { taskId }); },
  async retry() {
    updateRuntime({ connectivity: navigator.onLine ? 'connecting' : 'offline' });
    if (!initialized) {
      try { local = await loadLocal(); initialized = true; updateRuntime({ error: null }); }
      catch (error) { updateRuntime({ error: `Browser storage could not be opened. ${errorMessage(error)}`, connectivity: 'unavailable' }); return; }
    }
    await synchronize();
  },
  async install() {
    if (!installPrompt) return false;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    updateRuntime({ installAvailable: false });
    return true;
  },
  clearNotice() { updateRuntime({ error: null, notice: null }); },
};

window.addEventListener('hashchange', () => updateRuntime({ view: currentView() }));
window.addEventListener('online', () => { void synchronize(); });
window.addEventListener('offline', () => updateRuntime({ connectivity: 'offline' }));
window.addEventListener('focus', () => { void synchronize(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void synchronize(); });
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault(); installPrompt = event as InstallPrompt; updateRuntime({ installAvailable: true });
});
window.addEventListener('appinstalled', () => updateRuntime({ installAvailable: false, notice: 'Zaction is installed. Open it from your home screen.' }));

render();
void (async () => {
  try { local = await loadLocal(); initialized = true; }
  catch (error) { updateRuntime({ error: `Browser storage could not be opened. ${errorMessage(error)} Local saves will not be claimed until storage works.`, connectivity: 'unavailable' }); }
  bootstrapped = true;
  render();
  await synchronize();
  window.setInterval(() => { if (!document.hidden) void synchronize(); }, 3000);
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    try { await navigator.serviceWorker.register('/sw.js'); }
    catch { updateRuntime({ error: 'Offline installation is unavailable. You can keep using the connected app and retry after reloading.' }); }
  }
})();
