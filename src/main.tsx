import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
import { MEMBERS, ACTION_LIMITS, emptyActionInput, actionFor, draftsFor, progressFor, type ActionInput, type Actions, type AppState, type Choice, type CreationDraft, type DemoSnapshot, type LocalState, type Operation, type Receipt, type View } from './model';
import { emptyLocal, loadLocal, updateLocal } from './store';
import { parseSnapshot, validActionId } from './migrations';

const root = createRoot(document.getElementById('root')!);
let local: LocalState = emptyLocal();
// The stored last selection is a startup default, not cross-tab navigation.
// Each open tab keeps its own route target while sharing durable records.
let activeActionId = local.selectedActionId;
const views: View[] = ['home', 'create', 'action', 'proposal', 'progress', 'learn'];
function currentRoute(): { view: View; id?: string } | null {
  const [view, encodedId] = location.hash.slice(1).split('/');
  if (!views.includes(view as View)) return null;
  if (!encodedId) return { view: view as View };
  try { const id = decodeURIComponent(encodedId); return validActionId(id) ? { view: view as View, id } : null; }
  catch { return null; }
}
let runtime: Pick<AppState, 'view' | 'busy' | 'connectivity' | 'error' | 'notice' | 'installAvailable' | 'updateAvailable'> = {
  view: currentRoute()?.view ?? 'home', busy: false, connectivity: 'connecting', error: null, notice: null, installAvailable: false, updateAvailable: false,
};
let writes: Promise<void> = Promise.resolve();
let syncing = false;
let resync = false;
let initialized = false;
let bootstrapped = false;
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }> }
let installPrompt: InstallPrompt | null = null;
let workerRegistration: ServiceWorkerRegistration | undefined;

function render() {
  root.render(bootstrapped
    ? <React.StrictMode><App state={{ ...local, ...runtime, selectedActionId: activeActionId }} actions={actions} /></React.StrictMode>
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

function latestSnapshot(previous: DemoSnapshot | null, incoming: DemoSnapshot): DemoSnapshot {
  return previous?.roomId === incoming.roomId && previous.sequence > incoming.sequence ? previous : incoming;
}

async function request(path: string, options: RequestInit = {}) {
  const response = await fetch(path, { ...options, cache: 'no-store', signal: AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error(`The demo room could not complete the request (${response.status}).`);
  return response.json();
}

const acceptedMessages: Record<Operation['type'], string> = {
  'create-action': 'Your action and its proposal are now shared with the demo group.',
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
    const snapshot = parseSnapshot(await request('/api/state'));
    if (!await mutate(previous => ({ ...previous, snapshot: latestSnapshot(previous.snapshot, snapshot), lastSync: new Date().toISOString() }))) return;
    updateRuntime({ connectivity: 'online' });
    for (const pending of [...local.pending]) {
      if (!navigator.onLine) { updateRuntime({ connectivity: 'offline' }); break; }
      const result = await request('/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) });
      const nextSnapshot = parseSnapshot(result.snapshot);
      const receipt: Receipt = result.receipt;
      if (!receipt || receipt.id !== pending.id || receipt.actionId !== pending.actionId || typeof receipt.accepted !== 'boolean') throw new Error('The demo room returned an invalid receipt. Your pending action was preserved.');
      const saved = await mutate(previous => {
        const field = pending.type === 'minutes' ? 'minutes' : 'discussion';
        const draft = draftsFor(previous, pending.actionId);
        const restore = !receipt.accepted && ['contribute', 'minutes'].includes(pending.type) && !draft[field];
        return {
          ...previous, snapshot: latestSnapshot(previous.snapshot, nextSnapshot), lastSync: new Date().toISOString(),
          pending: previous.pending.filter(item => item.id !== pending.id),
          receipts: [...previous.receipts.filter(item => item.id !== receipt.id), { ...receipt, operation: pending }],
          drafts: restore ? { ...previous.drafts, [pending.actionId]: { ...draft, [field]: pending.text ?? '' } } : previous.drafts,
        };
      });
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

async function enqueue(type: Operation['type'], actionId: string, extra: Partial<Operation> = {}): Promise<boolean> {
  if (!local.memberId) { updateRuntime({ error: 'Choose a synthetic demo profile before sharing or voting.' }); return false; }
  if (!local.snapshot) { updateRuntime({ error: 'Connect once to load the demo room before submitting an action.' }); return false; }
  const target = actionFor(local, actionId);
  if (!validActionId(actionId) || (type !== 'create-action' && !target)) {
    updateRuntime({ error: 'This action is not available in the saved room. Your work has not been sent to another action.' }); return false;
  }
  if (['vote', 'create-action'].includes(type) && local.pending.some(item => item.type === type && item.memberId === local.memberId && item.actionId === actionId)) {
    updateRuntime({ notice: 'This submission is already saved for this action and awaiting acceptance.' }); return false;
  }
  const operation: Operation = {
    id: crypto.randomUUID(), type, memberId: local.memberId, roomId: local.snapshot.roomId, actionId,
    proposalRevision: target?.proposalRevision ?? 1, rulesVersion: target?.rulesVersion ?? 'DEMO-RULES-v1',
    membershipVersion: target?.membershipVersion ?? 'DEMO-MEMBERS-v1', ...extra,
  };
  updateRuntime({ busy: true, error: null });
  const saved = await mutate(previous => ({ ...previous, pending: [...previous.pending, operation] }));
  updateRuntime({ busy: false, ...(saved ? { notice: 'Saved on this device — awaiting group acceptance.' } : {}) });
  if (saved) void synchronize();
  return saved;
}

const actions: Actions = {
  navigate(view) {
    location.hash = view + (['action', 'proposal', 'progress'].includes(view) ? `/${activeActionId}` : '');
    updateRuntime({ view }); window.scrollTo({ top: 0 });
  },
  async selectAction(id, view = 'action') {
    if (!validActionId(id)) { updateRuntime({ error: 'This action link is invalid. Choose an action from the hub.' }); return; }
    if (await mutate(previous => ({ ...previous, selectedActionId: id }))) { activeActionId = id; actions.navigate(view); }
  },
  async join(memberId) {
    if (!MEMBERS.some(member => member.id === memberId)) return;
    if (await mutate(previous => ({ ...previous, memberId }))) updateRuntime({ error: null, notice: `You’re using ${MEMBERS.find(member => member.id === memberId)!.name}, a synthetic demo profile.` });
  },
  async saveDraft(actionId, text, field = 'discussion') {
    if (!validActionId(actionId)) return false;
    if (text.length > 2000) { updateRuntime({ error: 'Keep your contribution within 2,000 characters.' }); return false; }
    return mutate(previous => ({ ...previous, drafts: { ...previous.drafts, [actionId]: { ...draftsFor(previous, actionId), [field]: text } } }));
  },
  async saveCreationDraft(draft) {
    if (!validActionId(draft.id) || !Object.entries(ACTION_LIMITS).every(([field, limit]) => typeof draft[field as keyof CreationDraft] === 'string' && draft[field as keyof CreationDraft].length <= limit)) {
      updateRuntime({ error: 'The action draft contains an unsupported field or is too long. Keep your text and review the field limits.' }); return false;
    }
    return mutate(previous => ({ ...previous, creationDraft: { ...draft } }));
  },
  async newAction() {
    // An unfinished creation draft is resumed, never silently replaced. Once
    // accepted, the published action preserves it and another draft can begin.
    if (local.snapshot?.actions.some(action => action.id === local.creationDraft.id)) {
      if (!await mutate(previous => ({ ...previous, creationDraft: { id: crypto.randomUUID(), ...emptyActionInput() } }))) return;
    }
    actions.navigate('create');
  },
  async createAction(draft) {
    if (!await actions.saveCreationDraft(draft)) return false;
    const input = Object.fromEntries(Object.keys(ACTION_LIMITS).map(field => [field, draft[field as keyof CreationDraft].trim()])) as unknown as ActionInput;
    if (input.title.length < 3 || input.description.length < 10 || input.proposalTitle.length < 3 || input.beneficiaries.length < 3) {
      updateRuntime({ error: 'Add an action title, a description of at least 10 characters, a proposal title, and who benefits. Your draft is saved.' }); return false;
    }
    if (input.sourceUrl) {
      try { const url = new URL(input.sourceUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
      catch { updateRuntime({ error: 'Use an HTTPS source link without embedded credentials, or leave the link blank. Your draft is saved.' }); return false; }
    }
    if (local.snapshot?.actions.some(action => action.id === draft.id)) {
      updateRuntime({ notice: 'This action is already shared. Open it from your hub.' }); return false;
    }
    return enqueue('create-action', draft.id, { action: input });
  },
  async publishContribution(actionId, text) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000) { updateRuntime({ error: 'Write a question or correction of 1–2,000 characters.' }); return; }
    await enqueue('contribute', actionId, { text: trimmed });
  },
  async castVote(actionId, choice: Choice) { await enqueue('vote', actionId, { choice }); },
  async closeVote(actionId) { await enqueue('close', actionId); },
  async publishMinutes(actionId, text) {
    if (!text.trim() || text.trim().length > 2000) { updateRuntime({ error: 'Write decision notes of 1–2,000 characters.' }); return; }
    await enqueue('minutes', actionId, { text: text.trim() });
  },
  async toggleProgress(actionId, key) {
    if (!validActionId(actionId)) return;
    if (await mutate(previous => ({ ...previous, progress: { ...previous.progress, [actionId]: { ...progressFor(previous, actionId), [key]: !progressFor(previous, actionId)[key] } } }))) {
      updateRuntime({ notice: 'Personal progress saved privately on this device. Your voting weight stays the same.', error: null });
    }
  },
  async completeTask(actionId, taskId) { await enqueue('complete-task', actionId, { taskId }); },
  async retry() {
    updateRuntime({ connectivity: navigator.onLine ? 'connecting' : 'offline' });
    if (!initialized) {
      try { local = await loadLocal(); activeActionId = currentRoute()?.id ?? local.selectedActionId; initialized = true; updateRuntime({ error: null }); }
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
  async applyUpdate() {
    await writes;
    if (!workerRegistration?.waiting) { location.reload(); return; }
    navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
    workerRegistration.waiting.postMessage('SKIP_WAITING');
  },
  clearNotice() { updateRuntime({ error: null, notice: null }); },
};

window.addEventListener('hashchange', () => {
  const route = currentRoute();
  if (!route) return;
  void (async () => {
    if (route.id && route.id !== activeActionId) {
      if (!await mutate(previous => ({ ...previous, selectedActionId: route.id! }))) return;
      activeActionId = route.id;
    }
    updateRuntime({ view: route.view });
  })();
});
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
  try {
    local = await loadLocal(); initialized = true;
    const route = currentRoute();
    activeActionId = route?.id ?? local.selectedActionId;
    if (route?.id && route.id !== local.selectedActionId) await mutate(previous => ({ ...previous, selectedActionId: route.id! }));
  }
  catch (error) { updateRuntime({ error: `Browser storage could not be opened. ${errorMessage(error)} Local saves will not be claimed until storage works.`, connectivity: 'unavailable' }); }
  bootstrapped = true;
  render();
  await synchronize();
  window.setInterval(() => { if (!document.hidden) void synchronize(); }, 3000);
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    try {
      workerRegistration = await navigator.serviceWorker.register('/sw.js');
      if (workerRegistration.waiting) updateRuntime({ updateAvailable: true });
      workerRegistration.addEventListener('updatefound', () => {
        const installing = workerRegistration?.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) updateRuntime({ updateAvailable: true });
        });
      });
    }
    catch { updateRuntime({ error: 'Offline installation is unavailable. You can keep using the connected app and retry after reloading.' }); }
  }
})();
