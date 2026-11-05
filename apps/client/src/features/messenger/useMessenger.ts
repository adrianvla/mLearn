import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { ConversationAnalysisBatch, Contact, Conversation, ConversationDraft, ConversationGeneration, ConversationMessage, ConversationPreview, MessageReference, PluginSummary } from '@mlearn/contracts';
import { RuntimeError, type RuntimeClient } from '@mlearn/runtime-client';
import { mergeMessagePage, visibleMessageBatch } from './messageFlow';

const errorText = (cause: unknown) => cause instanceof Error ? cause.message : 'Native conversation action failed.';
type Action = { readonly origin: string; readonly run: () => Promise<void> };

export function useMessenger(client: RuntimeClient, initialId: string, focusSequence?: number) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [participants, setParticipants] = useState<Contact[]>([]);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [previews, setPreviews] = useState<ConversationPreview[]>([]);
  const [contactNext, setContactNext] = useState<string | null>(null);
  const [chatNext, setChatNext] = useState<string | null>(null);
  const [languages, setLanguages] = useState<PluginSummary[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [older, setOlder] = useState<number | null>(null);
  const [draft, setDraftState] = useState<ConversationDraft | null>(null);
  const [generation, setGeneration] = useState<ConversationGeneration | null>(null);
  const [analysis, setAnalysis] = useState<ConversationAnalysisBatch | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [visible, setVisible] = useState<string[]>([]);
  const [analysisAttempt, setAnalysisAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState('rail');
  const [retry, setRetry] = useState<Action | null>(null);
  const [listQuery, setListQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [historyQuery, setHistoryQuery] = useState('');
  const [listAttempt, setListAttempt] = useState(0);
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const [openAttempt, setOpenAttempt] = useState(0);
  const [generationAttempt, setGenerationAttempt] = useState(0);
  const [id, setId] = useState(initialId);
  const scope = useRef(0);
  const currentId = useRef(id); currentId.current = id;
  const workingDraft = useRef<ConversationDraft | null>(null);
  const savedDraft = useRef<ConversationDraft | null>(null);
  const draftCommand = useRef<ReturnType<RuntimeClient['prepareConversationDraft']> | null>(null);
  const rejectedDraft = useRef(false);
  const savingDraft = useRef<Promise<void> | null>(null);
  const runningAction = useRef<number | null>(null);
  const listEpoch = useRef(0);
  const participantEpoch = useRef(0);
  const followingTail = useRef(true);
  const searched = useRef({ id: initialId, query: '', attempt: 0 });
  useEffect(() => { setId(initialId); }, [initialId]);
  useEffect(() => {
    let active = true;
    client.snapshot().then(value => {
      if (active) setLanguages(value.installedPlugins.filter(plugin => plugin.capabilities.includes('text.analyze.v1')));
    }).catch(cause => { if (active) { setOrigin('rail'); setError(errorText(cause)); } });
    return () => { active = false; };
  }, [client]);
  useEffect(() => {
    let active = true;
    ++listEpoch.current;
    Promise.all([client.conversationContacts(listQuery, archived), client.conversations(listQuery)])
      .then(([people, conversations]) => {
        if (!active) return;
        setContacts(people.items); setContactNext(people.next);
        setChats(conversations.items); setChatNext(conversations.next);
        setPreviews(conversations.previews);
      }).catch(cause => { if (active) { setOrigin('rail'); setError(errorText(cause)); } });
    return () => { active = false; ++listEpoch.current; };
  }, [client, listQuery, archived, listAttempt]);
  useEffect(() => {
    const owned = ++scope.current;
    setPending(Boolean(id)); setConversation(null); setMessages([]); setOlder(null);
    setDraftState(null); workingDraft.current = null; savedDraft.current = null; draftCommand.current = null;
    rejectedDraft.current = false;
    setGeneration(null); setAnalysis(null); setVisible([]); setError(''); setRetry(null);
    if (!id) { setBusy(false); return; }
    setBusy(false);
    searched.current = { id, query: '', attempt: historyAttempt };
    Promise.all([client.conversation(id), client.conversationMessages(id, focusSequence === undefined ? null : focusSequence + 1), client.conversationDraft(id)])
      .then(([chat, page, restored]) => {
        if (scope.current !== owned) return;
        setConversation(chat); setMessages([...page.items].reverse()); setOlder(page.next);
        workingDraft.current = restored; savedDraft.current = restored; setDraftState(restored);
      }).catch(cause => { if (scope.current === owned) { setOrigin('history'); setError(errorText(cause)); } })
      .finally(() => { if (scope.current === owned) setPending(false); });
    return () => { if (scope.current === owned) scope.current++; };
  }, [client, id, focusSequence, openAttempt]);
  const participantIdentity = JSON.stringify(conversation?.participants ?? []);
  useEffect(() => {
    const owned = ++participantEpoch.current;
    setParticipants([]);
    if (conversation) Promise.all(conversation.participants.map(personId => client.conversationContact(personId)))
      .then(value => { if (participantEpoch.current === owned) setParticipants(value); })
      .catch(cause => { if (participantEpoch.current === owned) { setOrigin('header'); setError(errorText(cause)); } });
    return () => { if (participantEpoch.current === owned) participantEpoch.current++; };
  }, [client, id, participantIdentity]);
  useEffect(() => {
    if (!id || !conversation) return;
    if (searched.current.id === id && searched.current.query === historyQuery && searched.current.attempt === historyAttempt) return;
    searched.current = { id, query: historyQuery, attempt: historyAttempt };
    const owned = scope.current;
    let active = true;
    client.conversationMessages(id, null, historyQuery).then(page => {
      if (active && scope.current === owned) { setMessages([...page.items].reverse()); setOlder(page.next); }
    }).catch(cause => { if (active && scope.current === owned) { setOrigin('history'); setError(errorText(cause)); } });
    return () => { active = false; };
    // Conversation loading has its own first page; searching explicitly replaces it.
  }, [client, id, historyQuery, historyAttempt, Boolean(conversation)]);

  const activeGenerationId = generation && ['pending', 'streaming'].includes(generation.status) ? generation.id
    : messages.find(message => ['pending', 'partial'].includes(message.status))?.generationId;
  useEffect(() => {
    if (!activeGenerationId || !id) return;
    const generationId = activeGenerationId;
    const owned = scope.current;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Native owns streaming. Only an active generation schedules bounded status
    // reads; hidden/unmounted conversations release this subscription.
    async function refresh() {
      try {
        const [value, page, chat] = await Promise.all([
          client.conversationGeneration(generationId), client.conversationMessages(id, null, historyQuery), client.conversation(id),
        ]);
        if (!active || scope.current !== owned) return;
        setGeneration(value); setConversation(chat);
        if (!['pending', 'streaming'].includes(value.status)) setListAttempt(attempt => attempt + 1);
        setMessages(previous => mergeMessagePage(previous, followingTail.current
          ? page.items : page.items.filter(item => previous.some(message => message.id === item.id))));
        if (['pending', 'streaming'].includes(value.status)) timer = setTimeout(() => void refresh(), 600);
      } catch (cause) {
        if (active && scope.current === owned) {
          setOrigin('composer'); setError(errorText(cause));
          setRetry({ origin: 'composer', run: async () => { setGenerationAttempt(value => value + 1); } });
        }
      }
    }
    void refresh();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [client, id, activeGenerationId, historyQuery, generationAttempt]);

  const visibleMessages = visibleMessageBatch(messages, visible);
  const visibleIdentity = JSON.stringify(visibleMessages.map(message => [message.id, message.revision]));
  useEffect(() => {
    let active = true;
    const owned = scope.current;
    setAnalysisError('');
    if (visibleMessages.length) client.analyzeVisibleMessages(id, visibleMessages.map(message => ({ id: message.id, revision: message.revision })))
      .then(batch => {
        if (!active || scope.current !== owned) return;
        if (batch.packageId !== conversation?.packageId || batch.messages.some(analyzed =>
          !visibleMessages.some(message => message.id === analyzed.messageId && message.revision === analyzed.messageRevision
            && message.contentRevision === analyzed.contentRevision && message.text === analyzed.text)))
          throw new Error('Native analysis does not match the visible messages.');
        setAnalysis(batch);
      }).catch(cause => { if (active && scope.current === owned) setAnalysisError(errorText(cause)); });
    return () => { active = false; };
  }, [client, id, visibleIdentity, analysisAttempt, conversation?.packageId]);

  function changeDraft(text: string, replyTo: MessageReference | null = workingDraft.current?.replyTo ?? null) {
    if (!workingDraft.current) return;
    if (rejectedDraft.current) {
      rejectedDraft.current = false;
      setRetry(null); setError('');
    }
    const next = { ...workingDraft.current, text, replyTo };
    workingDraft.current = next; setDraftState(next);
  }
  async function persistDraft() {
    if (savingDraft.current) return savingDraft.current;
    const owned = scope.current;
    const save = async () => {
      while (scope.current === owned && workingDraft.current && savedDraft.current) {
        const desired = workingDraft.current;
        const saved = savedDraft.current;
        if (!draftCommand.current && desired.text === saved.text && JSON.stringify(desired.replyTo) === JSON.stringify(saved.replyTo)) return;
        const command = draftCommand.current ?? client.prepareConversationDraft({ ...desired, revision: saved.revision });
        draftCommand.current = command;
        let result: ConversationDraft;
        try {
          result = await client.saveConversationDraft(command);
        } catch (cause) {
          // An explicit validation rejection admitted no write. Keep the exact
          // command for uncertain receipts, but let corrected input replace this one.
          if (scope.current === owned && cause instanceof RuntimeError && cause.code === 'invalid_conversation') {
            draftCommand.current = null;
            rejectedDraft.current = true;
          }
          throw cause;
        }
        if (scope.current !== owned) return;
        draftCommand.current = null; savedDraft.current = result;
        workingDraft.current = { ...workingDraft.current, revision: result.revision };
        setDraftState(workingDraft.current);
      }
    };
    savingDraft.current = save().finally(() => { savingDraft.current = null; });
    return savingDraft.current;
  }
  const saveOnBackground = useRef(persistDraft);
  saveOnBackground.current = () => runningAction.current === scope.current || retry?.origin === 'composer'
    ? Promise.resolve() : persistDraft();
  useEffect(() => {
    const stop = AppState.addEventListener('change', state => {
      if (state !== 'active') void saveOnBackground.current().catch(cause => {
        setOrigin('composer'); setError(errorText(cause));
      });
    });
    return () => { stop.remove(); };
  }, []);
  async function act(action: Action) {
    const owned = scope.current;
    if (runningAction.current === owned) return;
    runningAction.current = owned; setBusy(true); setError(''); setOrigin(action.origin); setRetry(null);
    try { await action.run(); }
    catch (cause) {
      if (scope.current === owned) { setError(errorText(cause)); setRetry(action); }
    } finally {
      if (runningAction.current === owned) runningAction.current = null;
      if (scope.current === owned) setBusy(false);
    }
  }
  async function refreshCurrent() {
    if (currentId.current !== id) return;
    const owned = scope.current;
    const [chat, page] = await Promise.all([client.conversation(id), client.conversationMessages(id, null, historyQuery)]);
    if (scope.current !== owned || currentId.current !== id) return;
    setConversation(chat); setMessages(previous => mergeMessagePage(previous, page.items));
    setListAttempt(value => value + 1);
    setAnalysisAttempt(value => value + 1);
  }
  function select(next: string) {
    const action = { origin: 'composer', run: async () => {
      const owned = scope.current;
      await persistDraft();
      if (scope.current !== owned) return;
      if (next === id) { await refreshCurrent(); return; }
      setId(next); setHistoryQuery('');
    } };
    if (runningAction.current === scope.current) return action.run();
    return act(action);
  }
  function send(participantId: string) {
    if (!conversation || !draft?.text.trim()) return;
    const owned = scope.current;
    const turn = client.prepareConversationTurn(conversation, participantId, draft.text, draft.replyTo);
    let draftPersisted = false;
    let clear: ReturnType<RuntimeClient['prepareConversationDraft']> | null = null;
    const submitted = (value: ConversationDraft) => value.text === turn.text
      && JSON.stringify(value.replyTo) === JSON.stringify(turn.replyTo);
    void act({ origin: 'composer', run: async () => {
      if (!draftPersisted) { await persistDraft(); draftPersisted = true; }
      const value = await client.sendConversationTurn(turn);
      if (scope.current !== owned) return;
      setGeneration(value);
      // Clear only the exact submitted draft, using a stable idempotent command.
      if (!clear) {
        const saved = await client.conversationDraft(id);
        if (scope.current !== owned) return;
        if (!submitted(saved)) {
          const working = workingDraft.current;
          if (!working || working.text !== saved.text || JSON.stringify(working.replyTo) !== JSON.stringify(saved.replyTo))
            throw new Error('The saved draft changed during send. Review it before clearing.');
          // An uncertain admission may have been followed by new local input.
          // Its acknowledged draft is not part of the submitted turn.
          savedDraft.current = saved; workingDraft.current = saved; setDraftState(saved);
          await refreshCurrent();
          return;
        }
        clear = client.prepareConversationDraft({ ...saved, text: '', replyTo: null });
      }
      const restored = await client.saveConversationDraft(clear);
      if (scope.current !== owned) return;
      const working = workingDraft.current;
      savedDraft.current = restored;
      workingDraft.current = working && !submitted(working) ? { ...working, revision: restored.revision } : restored;
      setDraftState(workingDraft.current);
      // Reconcile later edits only after the exact clear receipt is recovered.
      // Retrying a lost clear must not first write against its old revision.
      await persistDraft();
      await refreshCurrent();
    } });
  }
  const setVisibleMessages = useCallback((ids: string[]) => {
    setVisible(previous => JSON.stringify(previous) === JSON.stringify(ids) ? previous : ids);
  }, []);
  return {
    contacts, participants, chats, previews, contactNext, chatNext, languages, conversation, messages, older, draft, generation,
    analysis, analysisError, pending, busy, error, origin, retry, id, listQuery, setListQuery, archived, setArchived,
    historyQuery, setHistoryQuery, select, send, changeDraft, persistDraft, act, refreshCurrent, setVisibleMessages,
    retryAnalysis: () => setAnalysisAttempt(value => value + 1),
    refreshLists: () => setListAttempt(value => value + 1),
    async contactChanged(contact: Contact) {
      if (!conversation?.participants.includes(contact.id)) {
        setListAttempt(value => value + 1);
        return;
      }
      const owned = scope.current;
      const participantLoad = ++participantEpoch.current;
      const people = await Promise.all(conversation.participants.map(personId => client.conversationContact(personId)));
      const changed = new Map<string, ConversationMessage>();
      const first = messages[0]?.sequence;
      const last = messages.at(-1)?.sequence;
      let before: number | null = last === undefined ? null : last + 1;
      // Refresh only the retained bounded window, not the latest page: a
      // contact edit must not discard the older history the learner is reading.
      while (before !== null && first !== undefined && before > first) {
        const page = await client.conversationMessages(id, before, historyQuery);
        if (scope.current !== owned || participantEpoch.current !== participantLoad) return;
        for (const message of page.items) changed.set(message.id, message);
        before = page.next;
      }
      const currentGeneration = generation ? await client.conversationGeneration(generation.id) : null;
      if (scope.current !== owned || participantEpoch.current !== participantLoad) return;
      setParticipants(people);
      setMessages(previous => previous.map(message => {
        const current = changed.get(message.id);
        return current && current.revision >= message.revision ? current : message;
      }));
      setGeneration(currentGeneration);
      setAnalysis(null);
      setAnalysisAttempt(value => value + 1);
      setListAttempt(value => value + 1);
    },
    setFollowing: (value: boolean) => { followingTail.current = value; },
    leaveDiscarded(conversationId: string) {
      if (conversationId !== currentId.current) return;
      workingDraft.current = null; savedDraft.current = null; draftCommand.current = null;
      setId(''); setHistoryQuery('');
    },
    latest: () => { followingTail.current = true; setHistoryQuery(''); setHistoryAttempt(value => value + 1); },
    reload: () => setOpenAttempt(value => value + 1),
    saveDraftOnBlur() {
      // The owning action must recover its save/send/clear receipt first.
      // A blur write here could race it using the pre-clear draft revision.
      if (runningAction.current === scope.current || retry?.origin === 'composer') return;
      const owned = scope.current;
      void persistDraft().catch(cause => {
        if (scope.current !== owned) return;
        setOrigin('composer'); setError(errorText(cause));
        setRetry({ origin: 'composer', run: persistDraft });
      });
    },
    async olderPage(beforePublish?: () => Promise<void>) {
      if (older === null) return;
      const owned = scope.current;
      const page = await client.conversationMessages(id, older, historyQuery);
      if (scope.current === owned) {
        await beforePublish?.();
        if (scope.current !== owned) return;
        setMessages(previous => mergeMessagePage(previous, page.items, true)); setOlder(page.next);
      }
    },
    async moreLists(people: boolean) {
      const query = listQuery;
      const owned = listEpoch.current;
      if (people && contactNext) {
        const page = await client.conversationContacts(query, archived, contactNext);
        if (owned === listEpoch.current) { setContacts(page.items); setContactNext(page.next); }
      } else if (!people && chatNext) {
        const page = await client.conversations(query, chatNext);
        if (owned === listEpoch.current) { setChats(page.items); setPreviews(page.previews); setChatNext(page.next); }
      }
    },
  };
}
