#[path = "support/conversation.rs"]
mod conversation_support;
use conversation_support::*;
use mlearn_core::*;
use mlearn_storage::ProfileStore;

fn room(store: &mut ProfileStore, members: &[&str]) -> Conversation {
    for key in members {
        person(store, key);
    }
    match run(
        store,
        ConversationCommand::CreateConversation {
            command_id: "create-room".into(),
            conversation: Conversation {
                id: ConversationId("room".into()),
                revision: 0,
                kind: ConversationKind::Room,
                title: "Cafe".into(),
                purpose: "Shared history".into(),
                package_id: "package".into(),
                participants: members.iter().map(|key| ContactId((*key).into())).collect(),
                discarded: false,
                absent: Vec::new(),
            },
        },
    ) {
        ConversationResult::Conversation { conversation } => conversation,
        other => panic!("{other:?}"),
    }
}

fn update(store: &mut ProfileStore, value: &Conversation, key: &str) -> Conversation {
    match run(
        store,
        ConversationCommand::UpdateConversation {
            command_id: format!("update-{key}"),
            conversation: value.clone(),
            expected_revision: value.revision,
        },
    ) {
        ConversationResult::Conversation { conversation } => conversation,
        other => panic!("{other:?}"),
    }
}

fn memory(store: &mut ProfileStore, owner: &Conversation, who: &str) -> Vec<String> {
    match run(
        store,
        ConversationCommand::ReadMemory {
            conversation_id: owner.id.clone(),
            contact_id: ContactId(who.into()),
            before: None,
        },
    ) {
        ConversationResult::Messages { page } => page.items.into_iter().map(|m| m.text).collect(),
        other => panic!("{other:?}"),
    }
}

fn current(store: &mut ProfileStore, owner: &Conversation) -> Conversation {
    match run(
        store,
        ConversationCommand::GetConversation {
            id: owner.id.clone(),
        },
    ) {
        ConversationResult::Conversation { conversation } => conversation,
        other => panic!("{other:?}"),
    }
}

#[test]
fn an_absent_member_neither_answers_nor_remembers_what_happened_meanwhile() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    let owner = room(&mut store, &["ana", "ben"]);
    // Given Ben is away while the learner talks to Ana.
    let mut away = owner.clone();
    away.absent = vec![ContactId("ben".into())];
    let away = update(&mut store, &away, "away");
    let mut said = turn(&away, "secret");
    said.participant_id = ContactId("ana".into());
    said.text = "Only Ana hears this".into();
    let generation = match run(&mut store, ConversationCommand::SendTurn { turn: said }) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    finish(&mut store, &generation);
    // Then Ben cannot be chosen to answer while away.
    let mut refused = turn(&current(&mut store, &away), "ben-away");
    refused.participant_id = ContactId("ben".into());
    assert!(
        store
            .conversation_command(&ConversationCommand::SendTurn { turn: refused }, false)
            .is_err()
    );
    // And when Ben returns, his memory and generation context exclude that exchange.
    let mut back = current(&mut store, &away);
    back.absent.clear();
    let back = update(&mut store, &back, "back");
    assert!(memory(&mut store, &back, "ana").contains(&"Only Ana hears this".to_owned()));
    assert!(!memory(&mut store, &back, "ben").contains(&"Only Ana hears this".to_owned()));
    let mut asked = turn(&back, "ben-back");
    asked.participant_id = ContactId("ben".into());
    asked.text = "Ben, what did I tell Ana?".into();
    let generation = match run(&mut store, ConversationCommand::SendTurn { turn: asked }) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    let context = store
        .conversation_generation_context(&generation.id)
        .unwrap();
    assert!(
        context
            .messages
            .iter()
            .all(|m| m.text != "Only Ana hears this")
    );
    assert!(
        context
            .messages
            .iter()
            .any(|m| m.text == "Ben, what did I tell Ana?")
    );
}

#[test]
fn director_picks_the_addressed_present_member_then_the_least_recent_speaker() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    let owner = room(&mut store, &["ana", "ben"]);
    let mut said = turn(&owner, "first");
    said.participant_id = ContactId("ana".into());
    let generation = match run(&mut store, ConversationCommand::SendTurn { turn: said }) {
        ConversationResult::Generation { generation } => generation,
        other => panic!("{other:?}"),
    };
    finish(&mut store, &generation);
    let owner = current(&mut store, &owner);
    let prepared = |store: &mut ProfileStore, owner: &Conversation| match run(
        store,
        ConversationCommand::PrepareTurn {
            conversation_id: owner.id.clone(),
            expected_revision: owner.revision,
        },
    ) {
        ConversationResult::Prepared { speaker, .. } => speaker,
        other => panic!("{other:?}"),
    };
    // Ana just answered, so Ben is next unless someone is addressed by name.
    assert_eq!(prepared(&mut store, &owner), Some(ContactId("ben".into())));
    let mut away = owner.clone();
    away.absent = vec![ContactId("ben".into())];
    let away = update(&mut store, &away, "director-away");
    assert_eq!(prepared(&mut store, &away), Some(ContactId("ana".into())));
}

#[test]
fn integration_is_deliberate_attributable_and_deletion_updates_memory() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    let owner = room(&mut store, &["person", "ben"]);
    let thread = create(&mut store, "practice", ConversationKind::Thread);
    let generation = send(&mut store, &thread, "practice-turn");
    finish(&mut store, &generation);
    let thread_page = page(&mut store, &thread);
    let chosen: Vec<_> = thread_page
        .items
        .iter()
        .map(|m| MessageReference {
            id: m.id.clone(),
            revision: m.revision,
        })
        .collect();
    let command = ConversationCommand::IntegrateThread {
        command_id: "integrate".into(),
        thread_id: thread.id.clone(),
        room_id: owner.id.clone(),
        expected_room_revision: owner.revision,
        messages: chosen.clone(),
    };
    run(&mut store, command.clone());
    // A retried receipt does not duplicate the integrated history.
    run(&mut store, command);
    let room_page = page(&mut store, &owner);
    assert_eq!(room_page.items.len(), chosen.len());
    assert!(room_page.items.iter().all(|m| m.integrated_from.is_some()));
    // Only Room members who took part in the Thread know about it.
    assert!(memory(&mut store, &owner, "person").contains(&"User practice-turn".to_owned()));
    assert!(!memory(&mut store, &owner, "ben").contains(&"User practice-turn".to_owned()));
    // Discarding the Thread keeps the deliberately integrated copy.
    let thread = current(&mut store, &thread);
    run(
        &mut store,
        ConversationCommand::DiscardConversation {
            command_id: "discard".into(),
            id: thread.id.clone(),
            expected_revision: thread.revision,
        },
    );
    assert_eq!(page(&mut store, &owner).items.len(), chosen.len());
    // Deleting the Room event removes it from every memory.
    let user = room_page
        .items
        .iter()
        .find(|m| m.text == "User practice-turn")
        .unwrap();
    run(
        &mut store,
        ConversationCommand::DeleteMessage {
            command_id: "delete".into(),
            message: MessageReference {
                id: user.id.clone(),
                revision: user.revision,
            },
        },
    );
    assert!(!memory(&mut store, &owner, "person").contains(&"User practice-turn".to_owned()));
}

#[test]
fn world_direction_is_bounded_and_revisioned() {
    let dir = tempfile::tempdir().unwrap();
    let mut store = ProfileStore::open(&dir.path().join("profile.sqlite")).unwrap();
    let owner = room(&mut store, &["ana"]);
    let world = ConversationWorld {
        conversation_id: owner.id.clone(),
        revision: 0,
        scenario: "A rainy afternoon in the cafe".into(),
        canon: vec![CanonEntry {
            position: 1,
            text: "Ana owns the cafe".into(),
        }],
        progress: 1,
    };
    let saved = match run(
        &mut store,
        ConversationCommand::SaveWorld {
            command_id: "world".into(),
            world: world.clone(),
            expected_revision: 0,
        },
    ) {
        ConversationResult::World { world } => world,
        other => panic!("{other:?}"),
    };
    assert_eq!(saved.revision, 1);
    assert_eq!(store.conversation_world(&owner.id).unwrap(), saved);
    // A stale writer cannot overwrite it.
    assert!(
        store
            .conversation_command(
                &ConversationCommand::SaveWorld {
                    command_id: "stale".into(),
                    world,
                    expected_revision: 0,
                },
                false,
            )
            .is_err()
    );
}
