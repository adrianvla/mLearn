use crate::{execution::Failure, guest::LanguageWork};
use mlearn_core::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

fn text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.contains('\0')
}

fn label(value: &LinguisticLabel, package: &str) -> bool {
    value.id.starts_with(&format!("{package}:"))
        && text(&value.id, 512)
        && text(&value.label, 128)
        && text(&value.attribution, 2048)
        && value.color.as_ref().is_none_or(|color| {
            color.len() == 7
                && color.starts_with('#')
                && color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
        })
}

fn properties(values: &[GraphProperty], package: &str) -> Result<bool, Failure> {
    if values.len() > 16 {
        return Ok(false);
    }
    let mut ids = BTreeSet::new();
    for value in values {
        if !value.id.starts_with(&format!("{package}:"))
            || !text(&value.id, 512)
            || !ids.insert(&value.id)
            || !text(&value.label, 128)
            || !text(&value.attribution, 2048)
            || serde_json::to_vec(&value.value)
                .map_err(|error| Failure::Operation(error.to_string()))?
                .len()
                > 2048
        {
            return Ok(false);
        }
    }
    Ok(true)
}

fn entity(
    entity: &LinguisticEntity,
    package: &str,
    schema: &LanguageDescription,
) -> Result<bool, Failure> {
    let mut capabilities = BTreeSet::new();
    Ok(text(&entity.id, 512)
        && text(&entity.label, 512)
        && label(&entity.kind, package)
        && text(&entity.attribution, 2048)
        && entity
            .target_id
            .as_ref()
            .is_none_or(|target| text(target, 512))
        && (entity.target_id.is_some() || entity.capabilities.is_empty())
        && entity.capabilities.len() <= 8
        && entity.capabilities.iter().all(|capability| {
            capabilities.insert(&capability.id) && schema.capabilities.contains(capability)
        })
        && properties(&entity.properties, package)?)
}

pub(super) fn identity(package: &str, revision: &str, target: &str) -> Result<String, Failure> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(package, revision, target))
                .map_err(|error| Failure::Operation(error.to_string()))?
        )
    ))
}

impl LanguageWork {
    pub(super) fn graph(&self, query: &GraphQuery) -> Result<GraphNeighborhood, Failure> {
        let schema = self.description()?;
        let value: GraphNeighborhood = serde_json::from_value(self.invoke(
            "graph.neighborhood.v1",
            serde_json::json!({
                "targetId": query.target_id,
                "after": query.after.as_ref().map(|cursor| &cursor.after),
            }),
        )?)
        .map_err(|error| Failure::Operation(error.to_string()))?;
        validate(&value, query, &schema)?;
        Ok(value)
    }
}

pub(super) fn validate(
    value: &GraphNeighborhood,
    query: &GraphQuery,
    schema: &LanguageDescription,
) -> Result<(), Failure> {
    let invalid = || Failure::Operation("Invalid package graph neighborhood".into());
    if value.connections.len() > 16
        || serde_json::to_vec(value)
            .map_err(|error| Failure::Operation(error.to_string()))?
            .len()
            > 128 * 1024
        || value.entity.target_id.as_deref() != Some(query.target_id.as_str())
        || !entity(&value.entity, &query.package_id, schema)?
        || value.next.as_ref().is_some_and(|next| {
            !text(next, 512)
                || query
                    .after
                    .as_ref()
                    .is_some_and(|cursor| &cursor.after == next)
        })
    {
        return Err(invalid());
    }
    let mut ids = BTreeSet::new();
    let mut entities = BTreeMap::from([(&value.entity.id, &value.entity)]);
    for connection in &value.connections {
        let relation = &connection.relation;
        if !text(&relation.id, 512)
            || !ids.insert(&relation.id)
            || !label(&relation.predicate, &query.package_id)
            || !text(&relation.attribution, 2048)
            || !properties(&relation.qualifiers, &query.package_id)?
            || !entity(&connection.entity, &query.package_id, schema)?
            || !((relation.from == value.entity.id && relation.to == connection.entity.id)
                || (relation.to == value.entity.id && relation.from == connection.entity.id))
        {
            return Err(invalid());
        }
        if entities
            .insert(&connection.entity.id, &connection.entity)
            .is_some_and(|previous| previous != &connection.entity)
        {
            return Err(invalid());
        }
    }
    Ok(())
}

impl crate::Runtime {
    pub(super) fn complete_graph(
        &self,
        query: &GraphQuery,
        package: &crate::Installed,
        value: &GraphNeighborhood,
    ) -> Result<Response, Failure> {
        // Edges are never learner authority. Read only the explicit target
        // bindings through the same Knowledge owner as annotations/Inspector.
        let mut keys = BTreeSet::new();
        for entity in
            std::iter::once(&value.entity).chain(value.connections.iter().map(|item| &item.entity))
        {
            if let Some(target) = &entity.target_id {
                for capability in &entity.capabilities {
                    keys.insert((target.clone(), capability.id.clone()));
                }
            }
        }
        let keys = keys
            .into_iter()
            .map(|(target_id, capability)| KnowledgeKey {
                package_id: query.package_id.clone(),
                target_id,
                capability,
            })
            .collect::<Vec<_>>();
        let revision = package.revision()?;
        let identity = identity(&query.package_id, &revision, &query.target_id)?;
        let next = value.next.as_ref().map(|after| GraphCursor {
            identity: identity.clone(),
            after: after.clone(),
        });
        Ok(Response::GraphNeighborhood {
            page: GraphPage {
                package_id: query.package_id.clone(),
                package_version: package.manifest.version.clone(),
                package_revision: revision,
                entity: value.entity.clone(),
                connections: value.connections.clone(),
                knowledge: self
                    .store
                    .knowledge(&keys)
                    .map_err(|error| Failure::Operation(error.to_string()))?,
                next,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> (GraphNeighborhood, GraphQuery, LanguageDescription) {
        let package = "org.example";
        let kind = LinguisticLabel {
            id: format!("{package}:unfamiliar-entity"),
            label: "Package entity".into(),
            color: None,
            attribution: "Package lexicon".into(),
        };
        let capability = Capability {
            id: format!("{package}:meaning"),
            label: "Meaning".into(),
        };
        let root = LinguisticEntity {
            id: "entity:root".into(),
            kind: kind.clone(),
            label: "Root".into(),
            target_id: Some("target:root".into()),
            capabilities: vec![capability.clone()],
            properties: vec![],
            attribution: "Package lexicon".into(),
        };
        let related = LinguisticEntity {
            id: "entity:other".into(),
            kind,
            label: "Other".into(),
            target_id: Some("target:other".into()),
            capabilities: vec![capability.clone()],
            properties: vec![GraphProperty {
                id: format!("{package}:unfamiliar-feature"),
                label: "Package feature".into(),
                value: json!({"nested": [{"qualifier": "retained", "weight": 0.25}]}),
                attribution: "Package lexicon".into(),
            }],
            attribution: "Package lexicon".into(),
        };
        let predicate = LinguisticLabel {
            id: format!("{package}:unfamiliar-relation"),
            label: "Package relation".into(),
            color: None,
            attribution: "Package lexicon".into(),
        };
        let connections = ["edge:a", "edge:b"]
            .into_iter()
            .map(|id| GraphConnection {
                relation: LinguisticRelation {
                    id: id.into(),
                    category: RelationCategory::Support,
                    predicate: predicate.clone(),
                    from: root.id.clone(),
                    to: related.id.clone(),
                    qualifiers: vec![GraphProperty {
                        id: format!("{package}:qualifier"),
                        label: "Qualifier".into(),
                        value: json!(id),
                        attribution: "Source record".into(),
                    }],
                    attribution: "Package lexicon".into(),
                },
                entity: related.clone(),
            })
            .collect();
        let value = GraphNeighborhood {
            entity: root,
            connections,
            next: Some("next".into()),
        };
        let query = GraphQuery {
            package_id: package.into(),
            target_id: "target:root".into(),
            expected_revision: None,
            after: None,
        };
        let schema = serde_json::from_value(json!({
            "language":"test","label":"Test","capabilities":[capability],
            "annotationCapability":format!("{package}:meaning"),"attribution":"Package lexicon"
        }))
        .unwrap();
        (value, query, schema)
    }

    #[test]
    fn unfamiliar_package_values_and_parallel_support_relations_survive_admission() {
        let (value, query, schema) = fixture();
        let decoded: GraphNeighborhood =
            serde_json::from_slice(&serde_json::to_vec(&value).unwrap()).unwrap();
        validate(&decoded, &query, &schema).unwrap();
        assert_eq!(decoded, value);
        assert_ne!(
            decoded.connections[0].relation.id,
            decoded.connections[1].relation.id
        );
        assert_ne!(
            decoded.connections[0].entity.target_id,
            decoded.entity.target_id
        );
    }

    #[test]
    fn malformed_or_conflicting_graph_identity_and_unbounded_payloads_are_rejected() {
        let (value, query, schema) = fixture();
        let mut invalid = value.clone();
        invalid.entity.target_id = Some("foreign-target".into());
        assert!(validate(&invalid, &query, &schema).is_err());
        let mut invalid = value.clone();
        invalid.connections[0].relation.from = "unrelated-entity".into();
        assert!(validate(&invalid, &query, &schema).is_err());
        let mut invalid = value.clone();
        invalid.connections[1].entity.label = "Conflicting metadata for the same entity".into();
        assert!(validate(&invalid, &query, &schema).is_err());
        let mut invalid = value.clone();
        invalid.connections[1].relation.id = invalid.connections[0].relation.id.clone();
        assert!(validate(&invalid, &query, &schema).is_err());
        let mut invalid = value.clone();
        invalid.connections = vec![invalid.connections[0].clone(); 17];
        assert!(validate(&invalid, &query, &schema).is_err());
        let mut invalid = value.clone();
        invalid.connections[0].entity.properties[0].value = json!("x".repeat(2049));
        assert!(validate(&invalid, &query, &schema).is_err());
        let mut invalid = value.clone();
        invalid.connections[0].entity.target_id = None;
        assert!(validate(&invalid, &query, &schema).is_err());
        let mut query = query;
        query.after = Some(GraphCursor {
            identity: "identity".into(),
            after: "next".into(),
        });
        assert!(validate(&value, &query, &schema).is_err());
    }
}
