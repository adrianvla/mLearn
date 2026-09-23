export interface ProtectionStatus {
  state: 'ready' | 'blocked' | 'unavailable';
  recoveryPoints: number;
  lastSnapshot?: string;
  reason?: string;
}
