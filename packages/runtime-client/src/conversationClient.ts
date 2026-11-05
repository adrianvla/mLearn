import type { Contact, Conversation, ConversationCommand, ConversationDraft, ConversationGeneration,
  ConversationResult, ConversationRetry, ConversationTurn, MessageReference, Request, SourceAnchor } from '@mlearn/contracts';
import { RuntimeError } from './errors';
import { encodedBytes } from './materialProtocol';
import { isConversationResponse } from './conversationProtocol';

type Command<A extends ConversationCommand['action']> = Extract<ConversationCommand, { action: A }>;
export function createConversationClient(request: (request: Request) => Promise<unknown>, identity: () => string,
  control: (request: Request) => Promise<unknown> = request) {
  const malformed = () => new RuntimeError('protocol', 'Malformed or mismatched conversation response.');
  async function read(command: ConversationCommand): Promise<ConversationResult> {
    const snapshot = structuredClone(command);
    if (encodedBytes(snapshot) > 65536) throw new RuntimeError('invalid_request', 'Conversation command exceeds its byte budget.');
    // Explanation may await a provider; neither cancellation nor saved-history
    // reads should queue behind that network lifetime.
    const execute = command.action === 'explain' || command.action === 'cancel_generation' ? control : request;
    const response = await execute({ type: 'conversation', command: snapshot });
    if (!isConversationResponse(response)) throw malformed();
    return response.result;
  }
  function ordered<T extends { id: string }>(items: T[], after: string | null, next: string | null) {
    if (items.some((item, index) => item.id <= (index ? items[index - 1].id : after ?? ''))
      || next !== null && next !== items.at(-1)?.id) throw malformed();
  }
  async function generation(command: ConversationCommand, id: string) {
    const r = await read(command);
    if (r.kind !== 'generation' || r.generation.id !== id) throw malformed();
    return r.generation;
  }
  const ref = (message: MessageReference): MessageReference => ({ id: message.id, revision: message.revision });
  return {
    async conversationContacts(query = '', archived: boolean | null = false, after: string | null = null) {
      const r = await read({ action: 'list_contacts', query, archived, after });
      if (r.kind !== 'contacts' || r.page.items.some(item => archived !== null && item.archived !== archived)) throw malformed();
      ordered(r.page.items, after, r.page.next); return r.page;
    },
    async conversationContact(id: string) {
      const r = await read({ action: 'get_contact', id });
      if (r.kind !== 'contact' || r.contact.id !== id) throw malformed();
      return r.contact;
    },
    prepareConversationContact(contact: Omit<Contact, 'id' | 'revision'> & Partial<Pick<Contact, 'id' | 'revision'>>): Command<'save_contact'> {
      const value = { ...contact, id: contact.id ?? identity(), revision: contact.revision ?? 0 };
      return { action: 'save_contact', commandId: identity(), contact: structuredClone(value), expectedRevision: value.revision };
    },
    async saveConversationContact(command: Command<'save_contact'>) {
      const r = await read(command);
      if (r.kind !== 'contact' || r.contact.id !== command.contact.id
        || r.contact.revision !== command.expectedRevision + 1) throw malformed();
      return r.contact;
    },
    async conversations(query = '', after: string | null = null) {
      const r = await read({ action: 'list_conversations', query, after });
      if (r.kind !== 'conversations' || r.page.items.some(item => item.discarded)) throw malformed();
      ordered(r.page.items, after, r.page.next); return r.page;
    },
    async conversation(id: string) {
      const r = await read({ action: 'get_conversation', id });
      if (r.kind !== 'conversation' || r.conversation.id !== id) throw malformed();
      return r.conversation;
    },
    prepareConversation(value: Omit<Conversation, 'id' | 'revision' | 'discarded'>): Command<'create_conversation'> {
      return { action: 'create_conversation', commandId: identity(),
        conversation: structuredClone({ ...value, id: identity(), revision: 0, discarded: false }) };
    },
    async createConversation(command: Command<'create_conversation'>) {
      const r = await read(command);
      // Direct creation deliberately reuses native identity for this person/package.
      if (r.kind !== 'conversation' || r.conversation.kind !== command.conversation.kind
        || r.conversation.packageId !== command.conversation.packageId || r.conversation.discarded
        || JSON.stringify(r.conversation.participants) !== JSON.stringify(command.conversation.participants)
        || (command.conversation.kind === 'thread'
          ? r.conversation.id !== command.conversation.id || r.conversation.revision !== 1 : r.conversation.revision < 1)) throw malformed();
      return r.conversation;
    },
    prepareConversationUpdate(conversation: Conversation): Command<'update_conversation'> {
      return { action: 'update_conversation', commandId: identity(), conversation: structuredClone(conversation), expectedRevision: conversation.revision };
    },
    async updateConversation(command: Command<'update_conversation'>) {
      const r = await read(command);
      if (r.kind !== 'conversation' || r.conversation.id !== command.conversation.id
        || r.conversation.revision !== command.expectedRevision + 1 || r.conversation.kind !== command.conversation.kind
        || r.conversation.packageId !== command.conversation.packageId) throw malformed();
      return r.conversation;
    },
    prepareConversationDiscard(conversation: Conversation): Command<'discard_conversation'> {
      return { action: 'discard_conversation', commandId: identity(), id: conversation.id, expectedRevision: conversation.revision };
    },
    async discardConversation(command: Command<'discard_conversation'>) {
      const r = await read(command);
      if (r.kind !== 'conversation' || r.conversation.id !== command.id
        || r.conversation.revision !== command.expectedRevision + 1 || !r.conversation.discarded) throw malformed();
      return r.conversation;
    },
    async conversationMessages(conversationId: string, before: number | null = null, query = '') {
      const r = await read({ action: 'read_messages', conversationId, before, query });
      if (r.kind !== 'messages' || r.page.items.some((item, index, items) => item.conversationId !== conversationId
        || item.sequence >= (index ? items[index - 1].sequence : before ?? Infinity))
        || r.page.next !== null && r.page.next !== r.page.items.at(-1)?.sequence) throw malformed();
      return r.page;
    },
    async conversationDraft(conversationId: string) {
      const r = await read({ action: 'read_draft', conversationId });
      if (r.kind !== 'draft' || r.draft.conversationId !== conversationId) throw malformed();
      return r.draft;
    },
    prepareConversationDraft(draft: ConversationDraft): Command<'save_draft'> {
      return { action: 'save_draft', commandId: identity(), draft: structuredClone(draft), expectedRevision: draft.revision };
    },
    async saveConversationDraft(command: Command<'save_draft'>) {
      const r = await read(command);
      if (r.kind !== 'draft' || r.draft.conversationId !== command.draft.conversationId
        || r.draft.revision !== command.expectedRevision + 1 || r.draft.text !== command.draft.text
        || JSON.stringify(r.draft.replyTo) !== JSON.stringify(command.draft.replyTo)) throw malformed();
      return r.draft;
    },
    prepareConversationMessageEdit(message: MessageReference, text: string): Command<'edit_message'> {
      return { action: 'edit_message', commandId: identity(), message: ref(message), text };
    },
    prepareConversationMessageDelete(message: MessageReference): Command<'delete_message'> {
      return { action: 'delete_message', commandId: identity(), message: ref(message) };
    },
    async changeConversationMessage(command: Command<'edit_message'> | Command<'delete_message'>) {
      const r = await read(command);
      if (r.kind !== 'message' || r.message.id !== command.message.id || r.message.revision !== command.message.revision + 1
        || (command.action === 'delete_message' ? r.message.status !== 'deleted'
          : r.message.status !== 'complete' || r.message.text !== command.text)) throw malformed();
      return r.message;
    },
    async prepareConversationContext(conversation: Conversation) {
      const r = await read({ action: 'prepare_turn', conversationId: conversation.id, expectedRevision: conversation.revision });
      if (r.kind !== 'prepared' || r.conversation.id !== conversation.id || r.conversation.revision !== conversation.revision
        || r.messages.some(item => item.conversationId !== conversation.id)
        || JSON.stringify(r.participants.map(item => item.id).sort()) !== JSON.stringify([...conversation.participants].sort())) throw malformed();
      return r;
    },
    prepareConversationTurn(conversation: Conversation, participantId: string, text: string,
      replyTo: MessageReference | null = null, sources: SourceAnchor[] = []): ConversationTurn {
      return { commandId: identity(), conversationId: conversation.id, expectedRevision: conversation.revision,
        userMessageId: identity(), assistantMessageId: identity(), generationId: identity(),
        participantId, text, replyTo: replyTo && ref(replyTo), sources: structuredClone(sources) };
    },
    async sendConversationTurn(turn: ConversationTurn) {
      const g = await generation({ action: 'send_turn', turn }, turn.generationId);
      if (g.conversationId !== turn.conversationId || g.conversationRevision !== turn.expectedRevision + 1
        || g.userMessageId !== turn.userMessageId || g.assistantMessageId !== turn.assistantMessageId || g.retryOf !== null) throw malformed();
      return g;
    },
    prepareConversationRetry(previous: ConversationGeneration, conversation: Conversation): ConversationRetry {
      if (previous.conversationId !== conversation.id)
        throw new RuntimeError('invalid_request', 'Generation does not belong to this conversation.');
      return { commandId: identity(), generationId: identity(), previousGenerationId: previous.id,
        assistantMessageId: identity(), expectedRevision: conversation.revision };
    },
    async retryConversationGeneration(retry: ConversationRetry, previous: ConversationGeneration) {
      const g = await generation({ action: 'retry_generation', retry }, retry.generationId);
      if (g.retryOf !== retry.previousGenerationId || g.assistantMessageId !== retry.assistantMessageId
        || previous.id !== retry.previousGenerationId || g.conversationId !== previous.conversationId
        || g.userMessageId !== previous.userMessageId || g.conversationRevision !== retry.expectedRevision + 1) throw malformed();
      return g;
    },
    prepareConversationStop(id: string): Command<'cancel_generation'> {
      return { action: 'cancel_generation', commandId: identity(), id };
    },
    async stopConversationGeneration(command: Command<'cancel_generation'>) { return generation(command, command.id); },
    conversationGeneration: (id: string) => generation({ action: 'read_generation', id }, id),
    async conversationTrace(id: string, after: number | null = null) {
      const r = await read({ action: 'read_trace', id, after });
      if (r.kind !== 'trace' || r.page.generation.id !== id
        || r.page.items.some(item => after !== null && item.sequence <= after)) throw malformed();
      return r.page;
    },
    async conversationProvider() {
      const r = await read({ action: 'read_provider_settings' });
      if (r.kind !== 'provider_settings') throw malformed();
      return r.settings;
    },
    prepareConversationProvider(expectedRevision: number, endpoint: string, model: string): Command<'save_provider_settings'> {
      return { action: 'save_provider_settings', commandId: identity(), expectedRevision, endpoint, model };
    },
    async saveConversationProvider(command: Command<'save_provider_settings'>) {
      const r = await read(command);
      if (r.kind !== 'provider_settings' || r.settings.revision !== command.expectedRevision + 1
        || r.settings.endpoint !== command.endpoint || r.settings.model !== command.model) throw malformed();
      return r.settings;
    },
    async setConversationSessionCredential(credential: string | null) {
      const r = await read({ action: 'set_session_credential', credential });
      if (r.kind !== 'credential_ready' || r.ready !== Boolean(credential)) throw malformed();
      return r.ready;
    },
    async analyzeVisibleMessages(conversationId: string, messages: MessageReference[]) {
      if (messages.length > 8 || new Set(messages.map(item => item.id)).size !== messages.length)
        throw new RuntimeError('invalid_request', 'Select at most eight distinct visible messages.');
      const r = await read({ action: 'analyze_visible_messages', conversationId, messages: messages.map(ref) });
      if (r.kind !== 'analysis' || r.batch.conversationId !== conversationId
        || r.batch.messages.some(item => !messages.some(message => message.id === item.messageId
          && message.revision === item.messageRevision))) throw malformed();
      return r.batch;
    },
    prepareConversationExplanation(source: SourceAnchor, instruction: string): Command<'explain'> {
      return { action: 'explain', commandId: identity(), source: structuredClone(source), instruction };
    },
    async analyzeConversationSource(source: SourceAnchor) {
      if (source.locator.kind !== 'message')
        throw new RuntimeError('invalid_request', 'Select a saved message source.');
      const locator = source.locator;
      const r = await read({ action: 'analyze_message_source', source: structuredClone(source) });
      if (r.kind !== 'analysis' || r.batch.conversationId !== locator.conversationId
        || r.batch.packageId !== source.packageId || r.batch.packageVersion !== source.packageVersion
        || r.batch.messages.length !== 1 || r.batch.messages[0].messageId !== locator.messageId
        || r.batch.messages[0].messageRevision !== locator.messageRevision
        || r.batch.messages[0].contentRevision !== source.contentRevision) throw malformed();
      return r.batch;
    },
    async explainConversationSource(command: Command<'explain'>) {
      const r = await read(command);
      if (r.kind !== 'generation' || r.generation.retryOf !== null) throw malformed();
      const g = r.generation;
      const [owner, history] = await Promise.all([
        read({ action: 'get_conversation', id: g.conversationId }),
        read({ action: 'read_messages', conversationId: g.conversationId, before: null, query: '' }),
      ]);
      if (owner.kind !== 'conversation' || owner.conversation.id !== g.conversationId
        || owner.conversation.kind !== 'thread' || owner.conversation.packageId !== command.source.packageId
        || owner.conversation.revision < g.conversationRevision || history.kind !== 'messages') throw malformed();
      const user = history.page.items.find(message => message.id === g.userMessageId);
      const assistant = history.page.items.find(message => message.id === g.assistantMessageId);
      const source = user?.sources[0];
      if (!user || !assistant || user.role !== 'user' || assistant.role !== 'assistant'
        || user.conversationId !== g.conversationId || assistant.conversationId !== g.conversationId
        || assistant.generationId !== g.id || user.text !== command.instruction || user.sources.length !== 1 || !source
        || source.sourceId !== command.source.sourceId || source.contentRevision !== command.source.contentRevision
        || source.packageId !== command.source.packageId || source.packageVersion !== command.source.packageVersion
        || source.text !== command.source.text || Object.entries(command.source.locator).some(([key, value]) =>
          !(key in source.locator) || Reflect.get(source.locator, key) !== value)) throw malformed();
      return g;
    },
  };
}
