import type { Component } from 'solid-js';
import type { WordStatus, RatingKeyboardMode } from '../../../shared/constants';
import type { CapabilityKey } from '../../../shared/graph/types';
import type { ProfileObservation, RateOptions } from '../../components/common';
import { RatingMatrix } from '../../components/common/RatingMatrix';

export interface WordSyncRatingProps {
  accesses: readonly CapabilityKey[];
  claims?: Readonly<Partial<Record<CapabilityKey, WordStatus>>>;
  capabilityLabels?: Readonly<Partial<Record<CapabilityKey, string>>>;
  focusedProbe?: boolean;
  keyboardMode: RatingKeyboardMode;
  armed: boolean;
  resetKey: string | number;
  onSubmit: (observations: readonly ProfileObservation[], opts?: RateOptions) => void;
}

/** Word Sync renders the canonical rating control; no local surface remains. */
export const WordSyncRating: Component<WordSyncRatingProps> = (props) => (
  <RatingMatrix
    capabilities={props.accesses}
    claims={props.claims}
    capabilityLabels={props.capabilityLabels}
    keyboardMode={props.keyboardMode}
    armed={props.armed}
    resetKey={props.resetKey}
    initiallyExpanded={props.focusedProbe}
    onSubmit={props.onSubmit}
  />
);
