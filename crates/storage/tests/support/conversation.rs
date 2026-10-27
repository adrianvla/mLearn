use mlearn_core::*;
use mlearn_storage::ProfileStore;

pub fn run(store: &mut ProfileStore, command: ConversationCommand) -> ConversationResult {
    store.conversation_command(&command, false).unwrap()
}

pub fn person(store: &mut ProfileStore, key: &str) -> Contact {
    match run(
        store,
        ConversationCommand::SaveContact {
            command_id: format!("person-{key}"),
            expected_revision: 0,
            contact: Contact {
                id: ContactId(key.into()),
                revision: 0,
                name: key.into(),
                description: "Actual participant".into(),
                archived: false,
            },
        },
    ) {
        ConversationResult::Contact { contact } => contact,
        other => panic!("{other:?}"),
    }
}

pub fn create(store: &mut ProfileStore, key: &str, kind: ConversationKind) -> Conversation {
    match run(
        store,
        ConversationCommand::CreateConversation {
            command_id: format!("create-{key}"),
            conversation: Conversation {
                id: ConversationId(key.into()),
                revision: 0,
                kind,
                title: key.into(),
                purpose: "Practice".into(),
                package_id: "package".into(),
                participants: vec![ContactId("person".into())],
                discarded: false,
            },
        },
    ) {
        ConversationResult::Conversation { conversation } => conversation,
        other => panic!("{other:?}"),
    }
}

pub fn fixture() -> (tempfile::TempDir, ProfileStore, Conversation) {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    person(&mut store, "person");
    let conversation = create(&mut store, "thread", ConversationKind::Thread);
    (dir, store, conversation)
}

pub fn turn(owner: &Conversation, key: &str) -> ConversationTurn {
    ConversationTurn {
        command_id: format!("send-{key}"),
        conversation_id: owner.id.clone(),
        expected_revision: owner.revision,
        user_message_id: MessageId(format!("user-{key}")),
        assistant_message_id: MessageId(format!("assistant-{key}")),
        generation_id: GenerationId(key.into()),
        participant_id: owner.participants[0].clone(),
        text: format!("User {key}"),
        reply_to: None,
        sources: vec![],
    }
}

pub fn send(store: &mut ProfileStore, owner: &Conversation, key: &str) -> ConversationGeneration {
    match run(
        store,
        ConversationCommand::SendTurn {
            turn: turn(owner, key),
        },
    ) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    }
}

pub fn start(store: &mut ProfileStore, generation: &ConversationGeneration) {
    store
        .record_conversation_request(&GenerationRequestRecord {
            command_id: format!("request-{}", generation.id.0),
            generation_id: generation.id.clone(),
            prompt: "actual prompt".into(),
            request: "{\"messages\":[]}".into(),
            started_at_ms: 10.0,
        })
        .unwrap();
}

pub fn finish(store: &mut ProfileStore, generation: &ConversationGeneration) {
    start(store, generation);
    store
        .finish_conversation_generation(&GenerationFinish {
            command_id: format!("finish-{}", generation.id.0),
            generation_id: generation.id.clone(),
            outcome: GenerationOutcome::Complete {
                response: "actual response".into(),
            },
            finished_at_ms: 20.0,
        })
        .unwrap();
}

pub fn page(store: &mut ProfileStore, owner: &Conversation) -> ConversationMessagePage {
    match run(
        store,
        ConversationCommand::ReadMessages {
            conversation_id: owner.id.clone(),
            before: None,
            query: "".into(),
        },
    ) {
        ConversationResult::Messages { page } => page,
        other => panic!("{other:?}"),
    }
}

pub fn person_get(store: &mut ProfileStore) -> Contact {
    match run(
        store,
        ConversationCommand::GetContact {
            id: ContactId("person".into()),
        },
    ) {
        ConversationResult::Contact { contact } => contact,
        other => panic!("{other:?}"),
    }
}
