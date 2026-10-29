import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import { MEMBERS, ACTION_LIMITS, CITY_OPTIONS, KIND_OPTIONS, communityFor, emptyActionInput, emptyPlanning, actionFor, draftsFor, progressFor, lifecycleFor, type ActionInput, type Actions, type AppState, type Choice, type CityId, type CreationDraft, type DemoSnapshot, type GatheringKind, type LocalState, type Operation, type Receipt, type View } from './model';
import { emptyLocal, loadLocal, loadCommunitySession, updateLocal, type SessionChange } from './store';
import { parseSnapshot, validActionId, validChangeContext } from './migrations';

const root = createRoot(document.getElementById('root')!);
let local: LocalState = emptyLocal();
// The stored last selection is a startup default, not cross-tab navigation.
// Each open tab keeps its own route target while sharing durable records.
let activeActionId = local.selectedActionId;
const views: View[] = ['home', 'plans', 'saved', 'profile', 'create', 'edit', 'action', 'proposal', 'progress', 'learn'];
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
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

function render() {
  root.render(bootstrapped
    ? <React.StrictMode><App state={{ ...local, ...runtime, selectedActionId: activeActionId }} actions={actions} /></React.StrictMode>
    : <main className="boot-screen" role="status"><strong>zaction.</strong><p>Opening your saved work…</p></main>);
}
function updateRuntime(patch: Partial<typeof runtime>) {
  runtime = { ...runtime, ...patch };
  if (patch.notice !== undefined) {
    clearTimeout(noticeTimer);
    if (patch.notice) noticeTimer = setTimeout(() => { runtime = { ...runtime, notice: null }; render(); }, 7000);
  }
  render();
}
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Something interrupted this action.'; }

async function mutate(update: (previous: LocalState) => LocalState, session?: SessionChange): Promise<boolean> {
  if (!initialized) {
    updateRuntime({ error: 'Local storage has not opened safely. Existing data is preserved. Retry to reopen storage before saving.' });
    return false;
  }
  let success = false;
  const operation = writes.then(async () => {
    local = await updateLocal(update, session);
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

async function request(path: string, options: RequestInit = {}, memberId?: string) {
  const headers = new Headers(options.headers);
  if (options.method === 'POST' && local.snapshot) {
    const session = await loadCommunitySession(local.snapshot.roomId);
    if (session && (!memberId || session.memberId === memberId)) headers.set('Authorization', `Bearer ${session.token}`);
  }
  const response = await fetch(path, { ...options, headers, cache: 'no-store', signal: AbortSignal.timeout(path.startsWith('/api/weather') ? 11000 : 7000) });
  const result = await response.json();
  if (!response.ok && !(result?.receipt?.accepted === false && result?.snapshot)) throw new Error(typeof result?.error === 'string' ? result.error : `The community could not complete this request (${response.status}).`);
  return result;
}

const acceptedMessages: Record<Operation['type'], string> = {
  'create-action': 'Your plan is shared. Let’s see what people think.',
  contribute: 'Your comment is posted.', vote: 'Your vote is recorded for this proposal.',
  close: 'The vote is closed. Add the decision notes when you’re ready.',
  minutes: 'Decision notes published. Earlier versions are still available.',
  'complete-task': 'Task marked complete (self-reported).',
  react: 'Your reaction is shared. It never changes a group vote.',
  rsvp: 'Your RSVP is updated. It is a plan to join, not proof of attendance.',
  'bring-item': 'Your bring-item choice is shared.',
  'change-plan': 'The new plan is shared. Everyone can review and choose again.',
  'cancel-plan': 'Your gathering is marked cancelled. The original group decision remains recorded.',
};

function templateDraft(cityId: CityId, kind?: GatheringKind): CreationDraft {
  const blank = { id: crypto.randomUUID(), ...emptyActionInput(), planning: emptyPlanning(cityId, kind ?? 'idea') };
  if (!kind) return blank;
  const titles = { bbq: 'A BBQ with good people', potluck: 'Bring a dish, meet a neighbor', games: 'Board games and good company', walk: 'A little fresh air, together', help: 'A little help for our neighborhood', idea: 'An idea worth talking about' };
  const descriptions = { bbq: 'Let’s share some food, meet a few neighbors, and make a good afternoon of it.', potluck: 'Bring something if you can. Come for the food and stay for the conversation.', games: 'An easy-going hangout with board games. New faces and first-time players welcome.', walk: 'Let’s get outside for a friendly neighborhood walk at a comfortable pace.', help: 'A small, practical way to make our community a little better, together.', idea: 'What could we do together that would make this community more welcoming?' };
  return { ...blank, title: titles[kind], description: descriptions[kind], proposalTitle: `Shall we make “${titles[kind]}” happen?`, beneficiaries: 'Our community' };
}

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
      const result = await request('/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending) }, pending.memberId);
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
      // Bring-item feedback stays beside the affected slot, including conflicts.
      updateRuntime(receipt.accepted ? (['react', 'rsvp', 'bring-item'].includes(pending.type) ? { error: null } : { notice: acceptedMessages[pending.type], error: null }) : pending.type === 'bring-item' ? { notice: null } : { error: `Not accepted: ${receipt.reason}. Your original submission is kept in its history.`, notice: null });
    }
  } catch {
    updateRuntime({ connectivity: navigator.onLine ? 'unavailable' : 'offline' });
  } finally {
    syncing = false;
    if (resync) { resync = false; void synchronize(); }
  }
}

async function enqueue(type: Operation['type'], actionId: string, extra: Partial<Operation> = {}): Promise<boolean> {
  if (!local.memberId) { updateRuntime({ error: 'Make a community profile before sharing or joining in. Your draft stays here.' }); return false; }
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
    membershipVersion: target?.membershipVersion ?? (MEMBERS.some(member => member.id === local.memberId) ? 'DEMO-MEMBERS-v1' : 'COMMUNITY-PREVIEW-v1'), ...extra,
  };
  updateRuntime({ busy: true, error: null });
  let duplicate = false;
  const saved = await mutate(previous => {
    const sameAuthorTransition = ['change-plan', 'cancel-plan'].includes(type) && previous.pending.some(item => ['change-plan', 'cancel-plan'].includes(item.type) && item.actionId === actionId && item.memberId === operation.memberId);
    if (sameAuthorTransition || type === 'bring-item' && previous.pending.some(item => item.type === type && item.actionId === actionId && item.memberId === operation.memberId && item.itemIndex === operation.itemIndex)) {
      duplicate = true;
      return previous;
    }
    return { ...previous, pending: [...previous.pending, operation] };
  });
  const announceQueue = type !== 'bring-item' && (!['react', 'rsvp'].includes(type) || runtime.connectivity !== 'online');
  updateRuntime({ busy: false, ...(saved && announceQueue ? { notice: 'Saved on this device — waiting to sync.' } : {}) });
  if (saved) void synchronize();
  return saved && !duplicate;
}

function inputForDraft(draft: CreationDraft): ActionInput | null {
  const input = Object.fromEntries(Object.keys(ACTION_LIMITS).map(field => [field, String(draft[field as keyof CreationDraft]).trim()])) as unknown as ActionInput;
  if (draft.planning) input.planning = structuredClone(draft.planning);
  if (input.title.length < 3 || input.description.length < 10 || input.proposalTitle.length < 3 || input.beneficiaries.length < 3) {
    updateRuntime({ error: 'Add an action title, a description of at least 10 characters, a proposal title, and who benefits. Your draft is saved.' }); return null;
  }
  if (input.sourceUrl) {
    try { const url = new URL(input.sourceUrl); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
    catch { updateRuntime({ error: 'Use an HTTPS source link without embedded credentials, or leave the link blank. Your draft is saved.' }); return null; }
  }
  return input;
}

function manageablePlan(actionId: string) {
  const plan = actionFor(local, actionId);
  if (!plan || !local.memberId || plan.createdBy !== local.memberId || plan.sourceKind !== 'member-provided') {
    updateRuntime({ error: 'Only this plan’s author can manage its listing using their preview profile. Your saved work stays here.' }); return null;
  }
  const lifecycle = lifecycleFor(plan);
  if (lifecycle.status === 'superseded' || lifecycle.replacementActionId) {
    updateRuntime({ error: 'This listing already has a separate new plan. Open it to prepare another change; your earlier draft is preserved.' }); return null;
  }
  return plan;
}

const actions: Actions = {
  navigate(view) {
    location.hash = view + (['action', 'proposal', 'progress', 'edit'].includes(view) ? `/${activeActionId}` : '');
    updateRuntime({ view }); window.scrollTo({ top: 0 });
  },
  async selectAction(id, view = 'action') {
    if (!validActionId(id)) { updateRuntime({ error: 'This action link is invalid. Choose an action from the hub.' }); return; }
    if (await mutate(previous => ({ ...previous, selectedActionId: id }))) { activeActionId = id; actions.navigate(view); }
  },
  async join(memberId) {
    if (!MEMBERS.some(member => member.id === memberId)) return;
    const name = MEMBERS.find(member => member.id === memberId)!.name;
    if (await mutate(previous => ({ ...previous, memberId, community: { ...communityFor(previous), name, onboarded: true, browsing: true } }))) updateRuntime({ error: null, notice: `You’re trying ${name}, a sample profile. Use your own profile for new community plans.` });
  },
  async finishOnboarding(input) {
    if (!await actions.savePreferences(input)) return false;
    if (input.name.trim().length < 2 || input.name.trim().length > 40) { updateRuntime({ error: 'Choose a public nickname of 2–40 characters. You do not need to use your real name.' }); return false; }
    if (!local.snapshot) await synchronize();
    if (!local.snapshot) { updateRuntime({ error: 'Connect once to join the community. Your setup choices are saved on this device.' }); return false; }
    updateRuntime({ busy: true, error: null });
    try {
      const result = await request('/api/community/join', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: input.name.trim(), cityId: input.cityId }) });
      const snapshot = parseSnapshot(result.snapshot);
      const profile = result.profile;
      if (!profile || typeof profile.id !== 'string' || typeof result.token !== 'string' || !/^[A-Za-z0-9_-]{32,512}$/.test(result.token) || !snapshot.profiles?.some(item => item.id === profile.id)) throw new Error('The community returned an unsupported profile. Your setup is still saved here.');
      const saved = await mutate(previous => ({ ...previous, memberId: profile.id, snapshot: latestSnapshot(previous.snapshot, snapshot), community: { ...communityFor(previous), ...input, name: profile.name, interests: [...input.interests], onboarded: true, browsing: false }, lastSync: new Date().toISOString() }), { roomId: snapshot.roomId, memberId: profile.id, token: result.token });
      if (saved) updateRuntime({ notice: `You’re in, ${profile.name}. Start with something you’d enjoy doing together.`, error: null });
      return saved;
    } catch (error) { updateRuntime({ error: `Couldn’t finish joining yet. ${errorMessage(error)} Your setup choices are still saved.` }); return false; }
    finally { updateRuntime({ busy: false }); }
  },
  async browseCommunity() {
    if (await mutate(previous => ({ ...previous, community: { ...communityFor(previous), browsing: true } }))) actions.navigate('home');
  },
  async savePreferences(preferences) {
    const current = { ...communityFor(local), ...preferences };
    if (typeof current.name !== 'string' || current.name.length > 40 || !CITY_OPTIONS.some(city => city.id === current.cityId) || !Array.isArray(current.interests) || !current.interests.every(id => KIND_OPTIONS.some(kind => kind.id === id))) { updateRuntime({ error: 'Review your nickname, city, and interests. Your earlier choices are still saved.' }); return false; }
    return mutate(previous => ({ ...previous, community: { ...communityFor(previous), ...preferences, ...(preferences.interests ? { interests: [...new Set(preferences.interests)] } : {}) } }));
  },
  async react(actionId, active) { await enqueue('react', actionId, { active }); },
  async rsvp(actionId, status) { await enqueue('rsvp', actionId, { status }); },
  async claimBringItem(actionId, itemIndex) { return enqueue('bring-item', actionId, { itemIndex, intent: 'claim' }); },
  async releaseBringItem(actionId, itemIndex, claimId) { return enqueue('bring-item', actionId, { itemIndex, intent: 'release', claimId }); },
  async toggleSave(actionId) {
    if (!validActionId(actionId)) return;
    if (await mutate(previous => ({ ...previous, savedActionIds: (previous.savedActionIds ?? []).includes(actionId) ? previous.savedActionIds!.filter(id => id !== actionId) : [...(previous.savedActionIds ?? []), actionId] }))) updateRuntime({ notice: 'Your saved plans stay private on this device.', error: null });
  },
  async setReplyTo(actionId, parentId) {
    if (!validActionId(actionId)) return;
    await mutate(previous => ({ ...previous, replyTargets: { ...previous.replyTargets, [actionId]: parentId } }));
  },
  async getWeather(cityId, date) {
    const context = { cityId, date, sourceUrl: 'https://open-meteo.com/' };
    try {
      const result = await request(`/api/weather?cityId=${encodeURIComponent(cityId)}&date=${encodeURIComponent(date)}`);
      if (!result || result.cityId !== cityId || result.date !== date || result.sourceUrl !== context.sourceUrl) throw new Error('The forecast did not match this city and date.');
      if (result.status === 'available' &&
          [result.temperatureMaxF, result.temperatureMinF, result.rainChance, result.windMph].every(value => typeof value === 'number' && Number.isFinite(value)) &&
          result.temperatureMinF <= result.temperatureMaxF && result.rainChance >= 0 && result.rainChance <= 100 && result.windMph >= 0 &&
          typeof result.checkedAt === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(result.checkedAt) && Number.isFinite(Date.parse(result.checkedAt)) &&
          typeof result.description === 'string' && Boolean(result.description.trim()) && typeof result.stale === 'boolean' &&
          (result.reason === undefined || typeof result.reason === 'string')) {
        return { ...context, status: 'available', checkedAt: result.checkedAt, temperatureMaxF: result.temperatureMaxF, temperatureMinF: result.temperatureMinF,
          rainChance: result.rainChance, windMph: result.windMph, description: result.description, stale: result.stale,
          ...(result.reason !== undefined ? { reason: result.reason } : {}) };
      }
      if (result.status === 'unavailable' && typeof result.reason === 'string' && result.reason.trim()) return { ...context, status: 'unavailable', reason: result.reason };
      throw new Error('Unsupported forecast response.');
    } catch { return { ...context, status: 'unavailable', reason: 'A forecast could not be verified for this city and date. Try again, or include a rain backup while making your plan.' }; }
  },
  async saveDraft(actionId, text, field = 'discussion') {
    if (!validActionId(actionId)) return false;
    if (text.length > 2000) { updateRuntime({ error: 'Keep your contribution within 2,000 characters.' }); return false; }
    return mutate(previous => ({ ...previous, drafts: { ...previous.drafts, [actionId]: { ...draftsFor(previous, actionId), [field]: text } } }));
  },
  async saveCreationDraft(draft) {
    if (draft.change || !validActionId(draft.id) || !Object.entries(ACTION_LIMITS).every(([field, limit]) => { const value = draft[field as keyof CreationDraft]; return typeof value === 'string' && value.length <= limit; })) {
      updateRuntime({ error: 'The action draft contains an unsupported field or is too long. Keep your text and review the field limits.' }); return false;
    }
    return mutate(previous => ({ ...previous, creationDraft: { ...draft } }));
  },
  async newAction(kind) {
    // An unfinished creation draft is resumed, never silently replaced. Once
    // accepted, the published action preserves it and another draft can begin.
    if (!await mutate(previous => {
      const current = previous.creationDraft;
      const suggested = templateDraft(communityFor(previous).cityId, kind);
      if (previous.snapshot?.actions.some(action => action.id === current.id)) return { ...previous, creationDraft: suggested };
      if (!current.title.trim() && kind) return { ...previous, creationDraft: { ...current, title: suggested.title, description: current.description || suggested.description, proposalTitle: current.proposalTitle || suggested.proposalTitle, beneficiaries: current.beneficiaries || suggested.beneficiaries, planning: current.planning ? { ...current.planning, kind } : suggested.planning } };
      return previous;
    })) return;
    actions.navigate('create');
  },
  async createAction(draft) {
    if (draft.change) { updateRuntime({ error: 'This is a change draft. Share it through the original plan’s review so its history stays linked.' }); return false; }
    if (!await actions.saveCreationDraft(draft)) return false;
    const input = inputForDraft(draft);
    if (!input) return false;
    if (local.snapshot?.actions.some(action => action.id === draft.id)) {
      updateRuntime({ notice: 'This action is already shared. Open it from your hub.' }); return false;
    }
    return enqueue('create-action', draft.id, { action: input });
  },
  async beginPlanChange(actionId) {
    const source = manageablePlan(actionId);
    if (!source) return false;
    const fields = Object.fromEntries(Object.keys(ACTION_LIMITS).map(key => [key, source[key as keyof ActionInput]])) as unknown as ActionInput;
    if (source.planning) fields.planning = structuredClone(source.planning);
    const draft: CreationDraft = { id: crypto.randomUUID(), ...fields, change: { actionId, expectedChangeId: lifecycleFor(source).changeId, reason: '' } };
    const saved = await mutate(previous => ({ ...previous, selectedActionId: actionId, planChangeDrafts: { ...previous.planChangeDrafts, [actionId]: previous.planChangeDrafts?.[actionId] ?? draft } }));
    if (saved) { activeActionId = actionId; actions.navigate('edit'); }
    return saved;
  },
  async savePlanChangeDraft(draft) {
    if (!validActionId(draft.id) || !validChangeContext(draft.change) || draft.id === draft.change.actionId || !Object.entries(ACTION_LIMITS).every(([field, limit]) => typeof draft[field as keyof CreationDraft] === 'string' && String(draft[field as keyof CreationDraft]).length <= limit)) {
      updateRuntime({ error: 'This change draft needs review. Keep your entered details; its original target has not been replaced.' }); return false;
    }
    const sourceId = draft.change.actionId;
    return mutate(previous => ({ ...previous, planChangeDrafts: { ...previous.planChangeDrafts, [sourceId]: structuredClone(draft) } }));
  },
  async reviewPlanChangeDraft(actionId) {
    if (runtime.connectivity !== 'online') {
      updateRuntime({ error: 'Connect and refresh the original listing before reviewing another attempt. Your entered change stays saved here.' }); return false;
    }
    const source = manageablePlan(actionId);
    if (!source) return false;
    if (local.pending.some(item => ['change-plan', 'cancel-plan'].includes(item.type) && item.actionId === actionId)) {
      updateRuntime({ error: 'This plan already has a saved change waiting for acceptance. Sync it before reviewing another attempt.' }); return false;
    }
    const changeId = lifecycleFor(source).changeId;
    return mutate(previous => {
      const draft = previous.planChangeDrafts?.[actionId];
      if (!draft?.change) return previous;
      return { ...previous, planChangeDrafts: { ...previous.planChangeDrafts, [actionId]: { ...draft, change: { ...draft.change, expectedChangeId: changeId } } } };
    });
  },
  async publishPlanChange(draft) {
    if (!await actions.savePlanChangeDraft(draft) || !draft.change) return false;
    const input = inputForDraft(draft);
    if (!input) return false;
    const reason = draft.change.reason.trim();
    if (reason.length < 5 || reason.length > 600) { updateRuntime({ error: 'Explain the change in 5–600 characters. Your draft is saved.' }); return false; }
    if (local.snapshot?.actions.some(item => item.id === draft.id)) { updateRuntime({ notice: 'This new plan is already shared. Open it to review its fresh participation.' }); return false; }
    return enqueue('change-plan', draft.change.actionId, { action: input, replacementActionId: draft.id, expectedChangeId: draft.change.expectedChangeId, changeReason: reason });
  },
  async saveCancelDraft(actionId, reason) {
    if (!validActionId(actionId) || typeof reason !== 'string' || reason.length > 600) return false;
    return mutate(previous => ({ ...previous, cancelDrafts: { ...previous.cancelDrafts, [actionId]: reason } }));
  },
  async cancelPlan(actionId, reason, expectedChangeId) {
    if (!await actions.saveCancelDraft(actionId, reason)) return false;
    const trimmed = reason.trim();
    if (trimmed.length < 5 || trimmed.length > 600) { updateRuntime({ error: 'Explain the cancellation in 5–600 characters. Your reason is saved here.' }); return false; }
    return enqueue('cancel-plan', actionId, { changeReason: trimmed, expectedChangeId });
  },
  async publishContribution(actionId, text, parentId) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 2000) { updateRuntime({ error: 'Write a question or correction of 1–2,000 characters.' }); return; }
    await enqueue('contribute', actionId, { text: trimmed, ...(parentId ? { parentId } : {}) });
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
