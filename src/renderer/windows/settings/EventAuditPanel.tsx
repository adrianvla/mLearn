import { RuntimeInspector } from '../conversationAgent/RuntimeInspector';

/** The settings entry uses the same gated, live inspector as Conversation. */
export function EventAuditPanel() { return <RuntimeInspector />; }
export default EventAuditPanel;
