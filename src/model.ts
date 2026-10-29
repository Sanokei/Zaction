export type MemberId = string;
export type Choice = 'approve' | 'oppose' | 'abstain';
export type View = 'home' | 'plans' | 'saved' | 'help' | 'profile' | 'create' | 'edit' | 'action' | 'proposal' | 'progress' | 'learn';
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
export const CITY_OPTIONS = [
  { id: 'new-york', name: 'New York', timezone: 'America/New_York' },
  { id: 'austin', name: 'Austin', timezone: 'America/Chicago' },
  { id: 'seattle', name: 'Seattle', timezone: 'America/Los_Angeles' },
  { id: 'chicago', name: 'Chicago', timezone: 'America/Chicago' },
  { id: 'los-angeles', name: 'Los Angeles', timezone: 'America/Los_Angeles' },
] as const;
export type CityId = typeof CITY_OPTIONS[number]['id'];
export const KIND_OPTIONS = [
  { id: 'bbq', name: 'BBQs & good food', emoji: '🍔' },
  { id: 'potluck', name: 'Bring & share', emoji: '🥗' },
  { id: 'games', name: 'Games & hangouts', emoji: '🎲' },
  { id: 'walk', name: 'Outside together', emoji: '🌿' },
  { id: 'help', name: 'Lend a hand', emoji: '🤝' },
  { id: 'idea', name: 'Good conversations', emoji: '💬' },
] as const;
export type GatheringKind = typeof KIND_OPTIONS[number]['id'];
export interface Planning {
  kind: GatheringKind;
  date: string;
  timeHint: string;
  cityId: CityId;
  place: string;
  budgetCents: number;
  expectedPeople: number;
  rainPlan: string;
  accessibility: string;
  bring: string[];
}
export const emptyPlanning = (cityId: CityId = 'new-york', kind: GatheringKind = 'idea'): Planning => ({ kind, cityId, date: '', timeHint: '', place: '', budgetCents: 0, expectedPeople: 8, rainPlan: '', accessibility: '', bring: [] });
export interface CommunityPreferences { name: string; cityId: CityId; interests: GatheringKind[]; onboarded: boolean; browsing: boolean }
export type OnboardingInput = Pick<CommunityPreferences, 'name' | 'cityId' | 'interests'>;
export interface CommunityProfile { id: MemberId; name: string; color: string; cityId: CityId; createdAt: string; synthetic: boolean }
export type RsvpStatus = 'going' | 'maybe' | 'none';
export interface Reaction { memberId: MemberId; createdAt: string }
export interface Rsvp { memberId: MemberId; status: Exclude<RsvpStatus, 'none'>; createdAt: string }
export interface BringClaim { id: string; itemIndex: number; memberId: MemberId; createdAt: string }
export type WeatherResult = {
  status: 'available'; cityId: string; date: string; checkedAt: string; sourceUrl: string;
  temperatureMaxF: number; temperatureMinF: number; rainChance: number; windMph: number; description: string; stale: boolean; reason?: string;
} | { status: 'unavailable'; cityId: string; date: string; sourceUrl: string; reason: string };
export interface ActionInput {
  title: string;
  description: string;
  proposalTitle: string;
  beneficiaries: string;
  whenWhere: string;
  sourceLabel: string;
  sourceUrl: string;
  planning?: Planning;
}
export interface PlanChangeContext { actionId: string; expectedChangeId: string | null; reason: string }
export interface CreationDraft extends ActionInput { id: string; change?: PlanChangeContext }
export interface PlanLifecycle { status: 'active' | 'superseded' | 'cancelled'; changeId: string | null; changedAt: string | null; changedBy: MemberId | null; reason: string; replacementActionId?: string }
export interface PlanOrigin { actionId: string; reason: string; kind: 'change' | 'restart' }
export const emptyActionInput = (): ActionInput => ({ title: '', description: '', proposalTitle: '', beneficiaries: '', whenWhere: '', sourceLabel: '', sourceUrl: '' });
export interface Contribution { id: string; memberId: MemberId; text: string; createdAt: string; parentId?: string }
export interface Ballot { id: string; memberId: MemberId; choice: Choice; createdAt: string }
export interface Minutes { id: string; memberId: MemberId; text: string; createdAt: string }
export interface CivicAction extends ActionInput {
  id: string;
  createdBy: MemberId | null;
  createdAt: string;
  sourceKind: 'synthetic' | 'member-provided';
  proposalRevision: 1;
  rulesVersion: 'DEMO-RULES-v1';
  membershipVersion: 'DEMO-MEMBERS-v1' | 'COMMUNITY-PREVIEW-v1';
  closesAt: string;
  contributions: Contribution[];
  ballots: Ballot[];
  outcome: Outcome;
  closedAt: string | null;
  minutes: Minutes[];
  completedTasks: { id: string; memberId: MemberId; createdAt: string }[];
  reactions?: Reaction[];
  rsvps?: Rsvp[];
  bringClaims?: BringClaim[];
  lifecycle?: PlanLifecycle;
  origin?: PlanOrigin;
}
export const lifecycleFor = (action: CivicAction): PlanLifecycle => action.lifecycle ?? { status: 'active', changeId: null, changedAt: null, changedBy: null, reason: '' };
export const isPlanActive = (action: CivicAction) => lifecycleFor(action).status === 'active';
export interface DemoSnapshot { schemaVersion: 2; roomId: string; sequence: number; actions: CivicAction[]; profiles?: CommunityProfile[] }
export interface Operation {
  id: string;
  memberId: MemberId;
  type: 'create-action' | 'contribute' | 'vote' | 'close' | 'minutes' | 'complete-task' | 'react' | 'rsvp' | 'bring-item' | 'change-plan' | 'cancel-plan';
  actionId: string;
  proposalRevision: 1;
  rulesVersion: 'DEMO-RULES-v1';
  membershipVersion: 'DEMO-MEMBERS-v1' | 'COMMUNITY-PREVIEW-v1';
  roomId: string;
  action?: ActionInput;
  text?: string;
  choice?: Choice;
  taskId?: string;
  parentId?: string;
  active?: boolean;
  status?: RsvpStatus;
  itemIndex?: number;
  intent?: 'claim' | 'release';
  claimId?: string;
  expectedChangeId?: string | null;
  replacementActionId?: string;
  changeReason?: string;
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
  community?: CommunityPreferences;
  savedActionIds?: string[];
  replyTargets?: Record<string, string | null>;
  planChangeDrafts?: Record<string, CreationDraft>;
  cancelDrafts?: Record<string, string>;
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
export const communityFor = (state: LocalState): CommunityPreferences => state.community ?? { name: '', cityId: 'new-york', interests: [], onboarded: false, browsing: false };
export const profileFor = (state: LocalState, id: string | null = state.memberId) => state.snapshot?.profiles?.find(profile => profile.id === id);
export const replyTargetFor = (state: LocalState, id = state.selectedActionId) => state.replyTargets && Object.hasOwn(state.replyTargets, id) ? state.replyTargets[id] : null;
export interface Actions {
  navigate(view: View): void;
  selectAction(id: string, view?: View): Promise<void>;
  join(memberId: MemberId): Promise<void>;
  saveDraft(actionId: string, text: string, field?: keyof ActionDrafts): Promise<boolean>;
  saveCreationDraft(draft: CreationDraft): Promise<boolean>;
  newAction(kind?: GatheringKind): Promise<void>;
  createAction(draft: CreationDraft): Promise<boolean>;
  beginPlanChange(actionId: string): Promise<boolean>;
  savePlanChangeDraft(draft: CreationDraft): Promise<boolean>;
  publishPlanChange(draft: CreationDraft): Promise<boolean>;
  reviewPlanChangeDraft(actionId: string): Promise<boolean>;
  saveCancelDraft(actionId: string, reason: string): Promise<boolean>;
  cancelPlan(actionId: string, reason: string, expectedChangeId: string | null): Promise<boolean>;
  publishContribution(actionId: string, text: string, parentId?: string): Promise<void>;
  setReplyTo(actionId: string, parentId: string | null): Promise<void>;
  finishOnboarding(profile: OnboardingInput): Promise<boolean>;
  browseCommunity(): Promise<void>;
  savePreferences(preferences: Partial<OnboardingInput>): Promise<boolean>;
  react(actionId: string, active: boolean): Promise<void>;
  rsvp(actionId: string, status: RsvpStatus): Promise<void>;
  claimBringItem(actionId: string, itemIndex: number): Promise<boolean>;
  releaseBringItem(actionId: string, itemIndex: number, claimId: string): Promise<boolean>;
  toggleSave(actionId: string): Promise<void>;
  getWeather(cityId: string, date: string): Promise<WeatherResult>;
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
