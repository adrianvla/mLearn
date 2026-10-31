use super::*;

fn lookup(key: &str) -> Result<Option<Value>, String> {
    Ok(match key {
        "lemma/child" => Some(json!(["wn30:n:0001:child", "wn30:n:0002:child"])),
        "lemma/kid" => Some(json!(["wn30:n:0001:kid"])),
        "sense/n:0001" => {
            Some(json!({"pos":"noun","definition":"young person","words":["child","kid"]}))
        }
        "sense/n:0002" => Some(json!({"pos":"noun","definition":"descendant","words":["child"]})),
        _ => None,
    })
}

#[test]
fn lexical_alternatives_and_synset_support_keep_distinct_target_bindings() {
    let result = neighborhood(
        json!({"targetId":"wn30:n:0001:child","after":null}),
        &lookup,
    )
    .unwrap();
    assert_eq!(
        result.entity.target_id.as_deref(),
        Some("wn30:n:0001:child")
    );
    assert_eq!(result.connections.len(), 2);
    assert_eq!(
        result.connections[0].relation.category,
        RelationCategory::Alternative
    );
    assert_eq!(
        result.connections[0].entity.target_id.as_deref(),
        Some("wn30:n:0002:child")
    );
    assert_eq!(
        result.connections[1].relation.category,
        RelationCategory::Support
    );
    assert_eq!(
        result.connections[1].entity.target_id.as_deref(),
        Some("wn30:n:0001:kid")
    );
    assert!(
        result
            .connections
            .iter()
            .all(|item| item.relation.category != RelationCategory::Identity)
    );
    assert_eq!(result.next, None);
}

#[test]
fn bounded_pages_visit_each_stable_relation_without_reinterpreting_a_cursor() {
    let lookup = |key: &str| -> Result<Option<Value>, String> {
        let alternatives = (0..35)
            .map(|index| format!("wn30:n:{index:04}:child"))
            .collect::<Vec<_>>();
        Ok(if key == "lemma/child" {
            Some(json!(alternatives))
        } else if key.starts_with("sense/n:") {
            Some(
                json!({"pos":"noun","definition":"one actual lexical alternative","words":["child"]}),
            )
        } else {
            None
        })
    };
    let first = neighborhood(
        json!({"targetId":"wn30:n:0000:child","after":null}),
        &lookup,
    )
    .unwrap();
    let second = neighborhood(
        json!({"targetId":"wn30:n:0000:child","after":first.next}),
        &lookup,
    )
    .unwrap();
    let third = neighborhood(
        json!({"targetId":"wn30:n:0000:child","after":second.next}),
        &lookup,
    )
    .unwrap();
    assert_eq!(
        [
            first.connections.len(),
            second.connections.len(),
            third.connections.len()
        ],
        [16, 16, 2]
    );
    let ids = first
        .connections
        .iter()
        .chain(&second.connections)
        .chain(&third.connections)
        .map(|item| &item.relation.id)
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(ids.len(), 34);
    assert!(third.next.is_none());
    assert!(
        neighborhood(
            json!({"targetId":"wn30:n:0000:child","after":"invalid"}),
            &lookup
        )
        .is_err()
    );
}
