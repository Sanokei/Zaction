export type MemberId = 'alex' | 'river' | 'jules';
export type Choice = 'approve' | 'oppose' | 'abstain';
export type View = 'home' | 'create' | 'action' | 'proposal' | 'progress' | 'learn';
export type Outcome = 'open' | 'adopted' | 'not-adopted' | 'no-quorum';
export const DEFAULT_ACTION_ID = 'reading-circle';
export const MEMBERS: { id: MemberId; name: string; color: string }[] = [
  { id: 'alex', name: 'Alex', color: '#7654cb' },
  { id: 'river', name: 'River', color: '#34755b' },
  { id: 'jules', name: 'Jules', color: '#b65c40' },
];
export const TASKS = [
  { id: 'accessibility', title: 'Check accessibility and participation needs', detail: 'Confirm arrangements with the people involved. No booking happens automatically.' },
  { id: 'agenda', title: 'Prepare the agreed plan', detail: 'Bring this action’s questions and next steps into one short, readable document.' },
  { id: 'minutes', title: 'Review and publish the decision notes', detail: 'Make this decision and its next steps clear to everyone.' },
] as const;
export const ACTION_LIMITS = { title: 100, description: 1200, proposalTitle: 140, beneficiaries: 240, whenWhere: 240, sourceLabel: 120, sourceUrl: 1000 } as const;
export interface ActionInput {
  title: string;
  description: string;
  proposalTitle: string;
  beneficiaries: string;
  whenWhere: string;
  sourceLabel: string;
  sourceUrl: string;
}
export interface CreationDraft extends ActionInput { id: string }
export const emptyActionInput = (): ActionInput => ({ title: '', description: '', proposalTitle: '', beneficiaries: '', whenWhere: '', sourceLabel: '', sourceUrl: '' });
export interface Contribution { id: string; memberId: MemberId; text: string; createdAt: string }
export interface Ballot { id: string; memberId: MemberId; choice: Choice; createdAt: string }
export interface Minutes { id: string; memberId: MemberId; text: string; createdAt: string }
export interface CivicAction extends ActionInput {
  id: string;
  createdBy: MemberId | null;
  createdAt: string;
  sourceKind: 'synthetic' | 'member-provided';
  proposalRevision: 1;
  rulesVersion: 'DEMO-RULES-v1';
  membershipVersion: 'DEMO-MEMBERS-v1';
  closesAt: string;
  contributions: Contribution[];
  ballots: Ballot[];
  outcome: Outcome;
  closedAt: string | null;
  minutes: Minutes[];
  completedTasks: { id: string; memberId: MemberId; createdAt: string }[];
}
export interface DemoSnapshot { schemaVersion: 2; roomId: string; sequence: number; actions: CivicAction[] }
export interface Operation {
  id: string;
  memberId: MemberId;
  type: 'create-action' | 'contribute' | 'vote' | 'close' | 'minutes' | 'complete-task';
  actionId: string;
  proposalRevision: 1;
  rulesVersion: 'DEMO-RULES-v1';
  membershipVersion: 'DEMO-MEMBERS-v1';
  roomId: string;
  action?: ActionInput;
  text?: string;
  choice?: Choice;
  taskId?: string;
}
export interface Receipt { id: string; actionId: string; accepted: boolean; reason: string; receivedAt: string; type: Operation['type']; operation?: Operation }
export interface ActionDrafts { discussion: string; minutes: string }
export interface PersonalProgress { read: boolean; reviewed: boolean }
export interface LocalState {
  schemaVersion: 2;
  memberId: MemberId | null;
  selectedActionId: string;
  snapshot: DemoSnapshot | null;
  drafts: Record<string, ActionDrafts>;
  progress: Record<string, PersonalProgress>;
  creationDraft: CreationDraft;
  pending: Operation[];
  receipts: Receipt[];
  lastSync: string | null;
  identityFingerprint: string;
}
export interface AppState extends LocalState {
  view: View;
  busy: boolean;
  connectivity: 'connecting' | 'online' | 'offline' | 'unavailable';
  error: string | null;
  notice: string | null;
  installAvailable: boolean;
  updateAvailable: boolean;
}
export const actionFor = (state: LocalState, id = state.selectedActionId) => state.snapshot?.actions.find(action => action.id === id);
export const draftsFor = (state: LocalState, id = state.selectedActionId): ActionDrafts => Object.hasOwn(state.drafts, id) ? state.drafts[id] : { discussion: '', minutes: '' };
export const progressFor = (state: LocalState, id = state.selectedActionId): PersonalProgress => Object.hasOwn(state.progress, id) ? state.progress[id] : { read: false, reviewed: false };
export interface Actions {
  navigate(view: View): void;
  selectAction(id: string, view?: View): Promise<void>;
  join(memberId: MemberId): Promise<void>;
  saveDraft(actionId: string, text: string, field?: keyof ActionDrafts): Promise<boolean>;
  saveCreationDraft(draft: CreationDraft): Promise<boolean>;
  newAction(): Promise<void>;
  createAction(draft: CreationDraft): Promise<boolean>;
  publishContribution(actionId: string, text: string): Promise<void>;
  castVote(actionId: string, choice: Choice): Promise<void>;
  closeVote(actionId: string): Promise<void>;
  publishMinutes(actionId: string, text: string): Promise<void>;
  toggleProgress(actionId: string, key: 'read' | 'reviewed'): Promise<void>;
  completeTask(actionId: string, taskId: string): Promise<void>;
  retry(): Promise<void>;
  install(): Promise<boolean>;
  applyUpdate(): Promise<void>;
  clearNotice(): void;
}
