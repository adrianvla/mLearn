# Open-world language boundary after the convergence pass

The current implementation is extensible storage plus a partly extensible learning runtime. It is not yet a fully open-world language system. This distinction matters more than whether an unfamiliar language code loads.

## What is already generic

Installed package metadata owns normalizer steps, language assets, adapter selection, labels, arbitrary graph feature payloads and namespaced capability IDs. `LanguageLearningConfig.capabilities` can declare task participation, surface/entity/family scope and identity sharing. Graph entities can carry opaque features and `learnableCapabilities`; compact graph loading and persistence preserve unknown data. Journal targets, capability folds, graph projections and RatingMatrix can transport/display unknown capabilities. The convergence fix passes language metadata to rating/claim/clear writers so a package's surface scope is honored at the write boundary as well as projection.

## Where genericity stops

1. `shared/types.ts:getAvailableAccesses` always invents sense-recognition and infers a fixed list from reading/prosody metadata. A package with none of those concepts cannot opt out completely.
2. `shared/graph/access.ts` owns a core access ontology, demonstrated-capability implications, legacy mappings, labels and mnemonics. `shared/graph/targets.ts:applicableCapabilities` derives familiar targets from known entity/relation kinds. Opaque additions can participate but cannot replace these inferred semantics.
3. `shared/languageFeatures.ts:getTestedAccesses` accepts arbitrary declarations through `testableIn`, but task templates, scaffolds, supplied/requested representations, and measurability still use core concepts. Declaring an unknown capability alone cannot supply a genuinely new assessment interaction or explain which structured evidence demonstrates it.
4. `renderer/utils/prosodyPresentationAdapters.ts`, `prosodyPayloadExtractors.ts`, `coloredProsody.ts` and `japanesePitchAccent.ts` retain a built-in Japanese prosody adapter. Renaming that adapter would not make it package-owned. The generic declarative overlay supports only its existing representation.
5. Core tokenization bricks still know familiar script/tokenizer inventories; Python installed adapters are a useful real behavior extension, but are not an unrestricted frontend task/presentation extension surface.

## Correct future boundary

Packages should declare entities, feature schemas, task contracts and presentation hints independently of core linguistic categories. Core should validate structural envelopes, enforce isolation/consent, address evidence, run generic scheduling and invoke declared behavior. A task contract must name supplied/requested representations, evidence targets and assessment semantics; identifiers and structured values remain package-owned. Presentation should degrade to labelled structured data for unsupported features. Executable adapters need an explicit trust/version/lifecycle contract; loading arbitrary renderer scripts from data is not a safe shortcut.

Existing packages should declare their current semantics explicitly before removing core inference. Maintain explicit versioned compatibility only for shipped data; do not treat an optional-field expansion or another capability switch as convergence.

Acceptance should use two synthetic packages: one declaring no familiar categories, another introducing an unfamiliar structured discourse relation attached to spans/participants rather than words. Exercise package install → load → graph → task → observation → persisted archive → replay → scheduling → inspection, including removal/update of the capability. Both must work without editing a core category list, and unsupported UI must preserve data without pretending to assess it.

This redesign is intentionally deferred: moving the current prosody helper into another core registry would add indirection without meeting the invariant; changing task/evidence semantics across all existing packages immediately before release risks invalidating learner history.
