# Language graph surface

## Overview

Mode: **Operate**. Learners inspect a canonical entity, choose a relationship,
read its connected entities, and deliberately explore another neighborhood.
This surface inherits mLearn's compact analytical UI and no-motion commitment
from `PRODUCT.md`; it does not establish a separate global visual system.

## Layout

The default is an all-connections overview, with one visual node per canonical
entity and all its relationship records retained. A single native select offers
optional relationship filters; there is no taxonomy sidebar. Dense branches show
a tappable count, leading to their complete paginated list. Phone layouts use a
vertically scrollable graph; desktop uses a compact three-column map.

Filtered diagrams show at most eight connections on desktop and four on phones.
Details appear only after selecting an item, in an immediately visible bottom
panel on phones. Zoom controls omit a percentage
readout; single-page pagination and permanent keyboard instructions are hidden.
Standalone learner diagnostics are behind the optional details disclosure.

## Colors and semantics

Use existing core theme tokens for backgrounds, text, borders, spacing, radii,
and typography. Primary color identifies focus/selection; success color marks an
evidence-backed known center when a host supplies that state. Dashed support and
extension connectors differ from the heavier identity connectors.

Connectors have no arrowheads: compact adjacency is mirrored and cannot recover
the original relation direction. Relationship text identifies the connection
without inventing direction. A lexical intermediary remains an explicit node and
group qualifier; a property reached through it must not look directly attached
to the center. Support relationships retain their explanatory caption.

## Inspection and navigation

Display labels prefer package-authored descriptions. Lexical entries may include
a summary of up to two package sense labels. These summaries leave canonical IDs
and source labels intact. Selection reveals a full label, relationship context,
and an explicit Explore action; expandable details expose raw IDs and metadata.

Back/forward visits restore relationship group, query, page, and viewport. The
shared request hook restores each entity's loaded extent by fetching fresh pages,
including extents beyond 200 connections. A new visit drops the forward branch.

Graph Inspector and the Word DB Editor reuse the component and request hook.
Same-language navigation keeps the explorer mounted while loading; stale requests
are ignored. Readiness changes clear prior graph data. Hosts expose loading,
unavailable/empty, failure/retry, and load-more states; pagination remains local
to the currently loaded group.

## Verification and limits

Component tests cover bounded layout, unknown package types, labels/raw details,
neutral connectors, lexical paths, selection, filtering, pagination, history, and
keyboard viewport controls. Hook tests cover stale responses, retry, page append,
loaded-extent restoration, and readiness changes. These test scopes do not imply
blanket all-theme or live Electron validation.

Original arrow direction remains unavailable. Short raw package labels can remain
when a description is absent. Filtering searches loaded connections within the
active relationship group, not the whole installed graph.
