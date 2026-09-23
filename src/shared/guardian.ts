export interface ProtectionStatus {
  state: 'ready' | 'blocked' | 'unavailable';
  recoveryPoints: number;
  lastSnapshot?: string;
  reason?: string;
}

export interface RecoveryPointSummary {
  id: string;
  createdAt: number;
  cards: number;
  rooms: number;
  participants: number;
}
