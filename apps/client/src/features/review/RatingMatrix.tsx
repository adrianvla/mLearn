import { useRef, useState } from 'react';
import { View } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import type { ReviewGrade, ReviewTarget } from '@mlearn/contracts';
import { Badge } from '@mlearn/ui/badge';
import { Button } from '@mlearn/ui/button';
import { Row } from '@mlearn/ui/layout';
import { Text } from '@mlearn/ui/text';
import { initialRating, rateAll, rateTarget, ratingActions, ratingGrade, ratingKey, type RatingState } from './rating';
import { useReviewKeys } from './useReviewKeys';

/** One compatible physical attempt, with explicit exceptions and untested rows. */
export function RatingMatrix({ targets, disabled, focused = false, onSubmit }: {
  readonly targets: readonly ReviewTarget[];
  readonly disabled: boolean;
  readonly focused?: boolean;
  readonly onSubmit: (grades: ReviewGrade[]) => void;
}) {
  const [state, setState] = useState(() => initialRating(focused));
  const [workedOut, setWorkedOut] = useState(false);
  const current = useRef(state);
  const submitted = useRef(false);
  function update(next: RatingState) { current.current = next; setState(next); }
  function submit(grades: ReviewGrade[]) {
    if (disabled || submitted.current || targets.length === 0) return;
    submitted.current = true;
    onSubmit(grades);
  }
  function apply(result: ReturnType<typeof ratingKey>) {
    update(result.state);
    if (result.grades) submit(result.grades);
    return result.handled;
  }
  useReviewKeys(!disabled, (key, at, alt) => apply(ratingKey(targets, current.current, key, at, alt || workedOut)));
  const method = workedOut ? 'worked_out' : 'remembered';
  return <View style={styles.matrix} testID="review-rating">
    <Row><Text variant="caption" muted>Recall</Text>{targets.map(target =>
      <Badge key={target.id} label={target.label} variant="label" />)}</Row>
    {!state.expanded ? <View style={styles.actions}>
      {ratingActions.map(action => <View key={action.key} style={styles.bulk}>
        <Button label={action.label} tone={action.tone} variant="pill" disabled={disabled}
          onPress={() => submit(rateAll(targets, current.current, action, method))} />
      </View>)}
    </View> : <>
      <Text variant="caption" muted>Choose exceptions, then All. Press a rating twice for All, or a rating followed by a row letter.</Text>
      <Text variant="caption" accessibilityLiveRegion="polite">{state.pending ? `Rating ${state.pending.key}: choose a row or repeat for All` : 'Adjust capability ratings'}</Text>
      <View style={styles.matrixRow}>
        <View style={styles.rowLabel} />
        {ratingActions.map(action => <View key={action.key} style={styles.cell}>
          <Text variant="detail" align="center">{action.label}</Text>
        </View>)}
      </View>
      <View style={styles.matrixRow}>
        <View style={styles.rowLabel}><Text variant="caption">All</Text></View>
        {ratingActions.map(action => <View key={action.key} style={styles.cell}>
        <Button label={`${action.key}${action.key}`} tone={action.tone} variant="pill" disabled={disabled}
          accessibilityLabel={`All ${action.label}`}
          onPress={() => submit(rateAll(targets, current.current, action, method))} />
      </View>)}</View>
      {targets.map(target => <View key={target.id} style={styles.target}>
        <View style={styles.matrixRow}>
          <View style={styles.rowLabel}><Text variant="caption">{target.label}</Text>
            {target.mnemonic ? <Text variant="caption" muted>{target.mnemonic.toUpperCase()}</Text> : null}</View>
          {ratingActions.map(action => {
            const grade = state.drafts[target.id];
            const selected = grade?.quality === action.quality && grade.easy === action.easy;
            return <View key={action.key} style={styles.cell}><Button label={selected ? '' : action.key} tone={action.tone} variant="pill"
              accessibilityLabel={`${target.label}: ${action.label}`} disabled={disabled}
              accessibilityState={{ selected }}
              onPress={() => apply(rateTarget(targets, current.current, ratingGrade(target.id, action, method)))} /></View>;
          })}
        </View>
        <Row><Button label="Untested" variant="secondary" disabled={disabled}
            accessibilityLabel={`${target.label}: Untested`} accessibilityState={{ selected: state.drafts[target.id]?.quality === null }}
            onPress={() => apply(rateTarget(targets, current.current, { targetId: target.id, quality: null, method, easy: false }))} /></Row>
      </View>)}
    </>}
    <Row><Button label={state.expanded ? 'Close Adjust' : 'Adjust'} variant="quiet"
      accessibilityState={{ expanded: state.expanded }} disabled={disabled}
      onPress={() => update({ ...current.current, expanded: !current.current.expanded, pending: null })} />
      <Button label="Worked out" variant="secondary" disabled={disabled}
        accessibilityState={{ selected: workedOut }} onPress={() => setWorkedOut(value => !value)} />
    </Row>
  </View>;
}
const styles = StyleSheet.create(theme => ({
  matrix: { gap: theme.spacing.small, width: '100%', minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.small, alignItems: 'stretch' },
  bulk: { flexGrow: 1, flexBasis: '20%', minWidth: 0 },
  matrixRow: { flexDirection: 'row', gap: theme.spacing.small, alignItems: 'center' },
  rowLabel: { flex: 1.5, minWidth: 0 },
  cell: { flex: 1, minWidth: 0 },
  target: { gap: theme.spacing.small, paddingTop: theme.spacing.small, borderTopWidth: 1, borderColor: theme.colors.border },
}));
