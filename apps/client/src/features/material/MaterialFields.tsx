import { useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { MaterialContent } from '@mlearn/contracts';
import { Badge } from '@mlearn/ui/badge';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { TextField } from '@mlearn/ui/text-field';

export type MaterialTextField = 'phrase' | 'reading' | 'meaning' | 'context' | 'notes' | 'examples';

/** Controlled authored text and read-only provenance, shared by saved and proposed Material. */
export function MaterialFields({ value, disabled, onChange }: {
  readonly value: MaterialContent;
  readonly disabled: boolean;
  readonly onChange: (update: (current: MaterialContent) => MaterialContent, field: MaterialTextField) => void;
}) {
  const [sourceDetails, setSourceDetails] = useState(false);
  function field(key: Exclude<MaterialTextField, 'examples'>, label: string, maxLength: number, multiline = false) {
    return <TextField label={label} testID={`material-${key}`} value={value[key]} maxLength={maxLength}
      multiline={multiline} multilineSize="compact" editable={!disabled} onChangeText={text => onChange(previous => ({
        ...previous, [key]: text,
        attachments: key === 'phrase' ? previous.attachments.map(item => ({ ...item, audioBinding: null })) : previous.attachments,
      }), key)} />;
  }
  return <View style={styles.fields}>
    <View style={styles.related}>
      <View style={styles.field}>{field('phrase', 'Phrase', 2048)}</View>
      <View style={styles.field}>{field('meaning', 'Meaning', 32768, true)}</View>
    </View>
    {field('reading', 'Reading', 2048)}
    <View style={styles.related}>
      <View style={styles.field}>{field('context', 'Context', 32768, true)}</View>
      <View style={styles.field}>{field('notes', 'Notes', 32768, true)}</View>
    </View>
    <Text accessibilityRole="header">Examples</Text>
    {value.examples.map((example, index) => <View key={index} style={styles.example}>
      <TextField label={`Example ${index + 1}`} value={example} maxLength={4096} editable={!disabled}
        onChangeText={text => onChange(previous => ({
          ...previous, examples: previous.examples.map((item, i) => i === index ? text : item),
        }), 'examples')} />
      <Button label={`Remove example ${index + 1}`} size="compact" variant="quiet" disabled={disabled}
        onPress={() => onChange(previous => ({
          ...previous, examples: previous.examples.filter((_, i) => i !== index),
        }), 'examples')} />
    </View>)}
    <Row><Button label="Add example" size="compact" variant="secondary" disabled={disabled || value.examples.length >= 16}
      onPress={() => onChange(previous => ({ ...previous, examples: [...previous.examples, ''] }), 'examples')} /></Row>
    {value.source ? <View style={styles.reference}>
      <Text variant="caption" muted>Original context</Text>
      <Text selectable>{value.source.text}</Text>
    </View> : null}
    {value.sense ? <View style={styles.reference}>
      <Badge label="Selected dictionary sense" />
      <Text selectable>{value.sense.heading} · {value.sense.definitions.join('; ')}</Text>
    </View> : null}
    {value.source || value.sense ? <View style={styles.reference}>
      <Button label="Source details" variant="quiet" size="compact"
        icon={sourceDetails ? 'chevronDown' : 'chevronRight'} accessibilityState={{ expanded: sourceDetails }}
        onPress={() => setSourceDetails(value => !value)} />
      {sourceDetails && value.source ? <Text variant="caption" muted selectable>Source reference · {value.source.sourceId} · {value.source.locator.kind === 'document'
        ? `${value.source.locator.resource} · ${value.source.locator.blockId} · bytes ${value.source.locator.contextStart + value.source.locator.selectionStart}–${value.source.locator.contextStart + value.source.locator.selectionEnd}`
        : value.source.locator.kind === 'image'
        ? `${value.source.locator.resourceId} · region ${value.source.locator.regionId} · recognition ${value.source.locator.ocrRevision}`
        : value.source.locator.kind === 'message'
        ? `message ${value.source.locator.messageId} · revision ${value.source.locator.messageRevision} · bytes ${value.source.locator.contextStart + value.source.locator.selectionStart}–${value.source.locator.contextStart + value.source.locator.selectionEnd}`
        : value.source.locator.cueIndex === null
        ? `frame at ${(value.source.locator.positionMs / 1000).toFixed(1)}s`
        : `cue ${value.source.locator.cueIndex + 1}`}</Text> : null}
      {sourceDetails && value.sense ? <Text variant="caption" muted selectable>Package revision: {value.packageRevision}</Text> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create(theme => ({
  fields: { gap: theme.spacing.compact, minWidth: 0 },
  related: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.compact },
  field: { flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0 },
  example: { gap: theme.spacing.small },
  reference: { gap: theme.spacing.small, paddingVertical: theme.spacing.small },
}));
