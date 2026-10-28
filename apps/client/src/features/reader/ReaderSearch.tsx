import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { DocumentPosition, DocumentRecord, DocumentSearchCursor, DocumentSearchHit,
    DocumentSearchPage, DocumentSearchScope } from '@mlearn/contracts';
import type { RuntimeClient } from '@mlearn/runtime-client';
import { Button } from '@mlearn/ui/button';
import { Dialog } from '@mlearn/ui/dialog';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';

export function ReaderSearch({ client, source, scope, position, compact, disabled, onLocate, onReturn, onOpen }: {
    readonly client: RuntimeClient;
    readonly source: DocumentRecord;
    readonly scope: DocumentSearchScope;
    readonly position: DocumentPosition | null;
    readonly compact: boolean;
    readonly disabled: boolean;
    readonly onLocate: (hit: DocumentSearchHit) => Promise<boolean>;
    readonly onReturn: (position: DocumentPosition) => Promise<boolean>;
    readonly onOpen: () => void;
}) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const [page, setPage] = useState<DocumentSearchPage | null>(null);
    const [origin, setOrigin] = useState<DocumentPosition | null>(null);
    const [pending, setPending] = useState(false);
    const [navigating, setNavigating] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('');
    const operation = useRef<object | null>(null);
    const live = useRef(true);
    const retry = useRef<{ text: string; after: DocumentSearchCursor | null } | null>(null);
    useEffect(() => {
        live.current = true;
        return () => { live.current = false; operation.current = null; };
    }, []);

    function stop() {
        operation.current = null; setPending(false); setStatus('Search stopped. Search again to restart.');
    }
    async function search(query: string, after: DocumentSearchCursor | null = null) {
        if (operation.current || disabled) return;
        if (!query.length || new TextEncoder().encode(query).length > 1024) {
            setError('Enter search text of at most 1024 UTF-8 bytes.'); return;
        }
        const owner = {}; operation.current = owner;
        setPending(true); setError(''); setStatus('');
        if (!after) setPage(null);
        let cursor = after;
        try {
            // Read bounded native quanta until a result page or end. Stop/close
            // discards in-flight publication and prevents the next read.
            do {
                retry.current = { text: query, after: cursor };
                const result = await client.searchDocument({ sourceId: source.id, contentRevision: source.contentRevision,
                    parserRevision: source.parserRevision, scope, text: query, after: cursor });
                if (!live.current || operation.current !== owner) return;
                setPage(result); cursor = result.next;
                if (result.hits.length || !cursor) break;
            } while (operation.current === owner);
            retry.current = null;
        } catch (cause) {
            if (live.current && operation.current === owner)
                setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (live.current && operation.current === owner) {
                operation.current = null; setPending(false);
            }
        }
    }
    async function locate(hit?: DocumentSearchHit) {
        if (operation.current || disabled) return;
        const owner = {}; operation.current = owner;
        const previous = position;
        setPending(true); setNavigating(true); setError(''); setStatus('');
        try {
            const accepted = hit ? await onLocate(hit) : origin ? await onReturn(origin) : false;
            if (!live.current || operation.current !== owner) return;
            if (!accepted) { setError('Could not navigate. Close search to inspect Reader recovery, then retry.'); return; }
            if (hit) setOrigin(value => value ?? previous);
            else setOrigin(null);
            setOpen(false);
        } catch (cause) {
            if (live.current && operation.current === owner)
                setError(cause instanceof Error ? cause.message : String(cause));
        } finally {
            if (live.current && operation.current === owner) {
                operation.current = null; setPending(false); setNavigating(false);
            }
        }
    }
    return <Dialog title="Search source" description={scope === 'text'
        ? 'Exact, case-sensitive search in canonical document text.'
        : 'Exact, case-sensitive search in saved recognized pages. Search does not run recognition.'}
        open={open} onOpenChange={value => {
            setOpen(value);
            if (value) onOpen();
            else if (operation.current && !navigating) stop();
        }} trigger={<Button label="Search source" icon="search" iconOnly={compact}
            variant="secondary" size="compact" disabled={disabled} />}>
        <View style={styles.stack}>
            <TextField label="Search this source" value={text} maxLength={1024} editable={!pending}
                onChangeText={value => { setText(value); setError(''); }}
                onSubmitEditing={() => void search(text)} returnKeyType="search" />
            <Row>
                <Button label="Search" disabled={pending || disabled || !text.length} onPress={() => void search(text)} />
                {pending && !navigating ? <Button label="Stop search" variant="secondary" onPress={stop} /> : null}
                {origin ? <Button label="Return to reading position" variant="secondary" disabled={pending || disabled}
                    onPress={() => void locate()} /> : null}
            </Row>
            {pending ? <Text accessibilityLiveRegion="polite">Searching or navigating…</Text> : null}
            {status ? <Text accessibilityLiveRegion="polite">{status}</Text> : null}
            {error ? <Text accessibilityRole="alert">{error}</Text> : null}
            {error && retry.current ? <Button label="Retry search" disabled={pending || disabled}
                onPress={() => { const held = retry.current; if (held) void search(held.text, held.after); }} /> : null}
            {page ? <>
                <Text variant="caption" muted>{page.scanned} of {page.total} {scope === 'text' ? 'blocks' : 'pages'} scanned
                    {page.unavailable ? ` · ${page.unavailable} ${scope === 'text'
                        ? 'blocks without searchable text' : 'pages without available recognition'}` : ''}</Text>
                {!pending && !page.hits.length && !page.next ? <Text>No matches in available {scope === 'text' ? 'text' : 'recognition'}.</Text> : null}
                {page.hits.map((hit, index) => <Button key={JSON.stringify([hit.position, index])}
                    label={hit.anchor.text} detail={hit.anchor.locator.kind === 'image'
                        ? `Page ${(hit.anchor.locator.pageIndex ?? 0) + 1}`
                        : `${hit.position.resource} · byte ${hit.position.offset}`}
                    variant="secondary" disabled={pending || disabled} onPress={() => void locate(hit)} />)}
                <Button label="More search results" variant="secondary" disabled={pending || disabled || !page.next}
                    onPress={() => { if (page.next) void search(page.text, page.next); }} />
            </> : null}
        </View>
    </Dialog>;
}

const styles = StyleSheet.create(theme => ({
    stack: { gap: theme.spacing.compact, minWidth: 0 },
}));
