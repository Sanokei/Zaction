export type MemberId = 'alex' | 'river' | 'jules';
export type Choice = 'approve' | 'oppose' | 'abstain';
export type View = 'home' | 'action' | 'proposal' | 'progress' | 'learn';
export type Outcome = 'open' | 'adopted' | 'not-adopted' | 'no-quorum';
export const MEMBERS: { id: MemberId; name: string; color: string }[] = [
  { id: 'alex', name: 'Alex', color: '#7654cb' },
  { id: 'river', name: 'River', color: '#34755b' },
  { id: 'jules', name: 'Jules', color: '#b65c40' },
];
export const TASKS = [
  { id: 'accessibility', title: 'Check the meeting space is accessible', detail: 'Ask about step-free access and a quiet space. No booking happens in Zaction.' },
  { id: 'agenda', title: 'Prepare the reading-circle agenda', detail: 'Bring the group’s questions into one short, readable document.' },
  { id: 'minutes', title: 'Review and publish the decision notes', detail: 'Make the decision and its next steps clear to everyone.' },
] as const;
export interface Contribution { id: string; memberId: MemberId; text: string; createdAt: string }
export interface Ballot { id: string; memberId: MemberId; choice: Choice; createdAt: string }
export interface Minutes { id: string; memberId: MemberId; text: string; createdAt: string }
export interface DemoSnapshot {
  schemaVersion: 1;
  roomId: string;
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
export interface Operation {
  id: string;
  memberId: MemberId;
  type: 'contribute' | 'vote' | 'close' | 'minutes' | 'complete-task';
  proposalRevision: 1;
  rulesVersion: 'DEMO-RULES-v1';
  membershipVersion: 'DEMO-MEMBERS-v1';
  roomId: string;
  text?: string;
  choice?: Choice;
  taskId?: string;
}
export interface Receipt { id: string; accepted: boolean; reason: string; receivedAt: string; type: Operation['type']; operation?: Operation }
export interface LocalState {
  memberId: MemberId | null;
  snapshot: DemoSnapshot | null;
  draft: string;
  progress: { read: boolean; reviewed: boolean };
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
}
export interface Actions {
  navigate(view: View): void;
  join(memberId: MemberId): Promise<void>;
  saveDraft(text: string): Promise<boolean>;
  publishContribution(text: string): Promise<void>;
  castVote(choice: Choice): Promise<void>;
  closeVote(): Promise<void>;
  publishMinutes(text: string): Promise<void>;
  toggleProgress(key: 'read' | 'reviewed'): Promise<void>;
  completeTask(taskId: string): Promise<void>;
  retry(): Promise<void>;
  install(): Promise<boolean>;
  clearNotice(): void;
}
