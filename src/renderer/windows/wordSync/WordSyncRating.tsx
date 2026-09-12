import type { Component } from 'solid-js';
import type { RatingKeyboardMode } from '../../../shared/constants';
import type { CapabilityKey } from '../../../shared/graph/types';
import type { ProfileObservation, RateOptions } from '../../components/common';
import { RatingMatrix } from '../../components/common/RatingMatrix';

export interface WordSyncRatingProps {
  accesses: readonly CapabilityKey[];
  keyboardMode: RatingKeyboardMode;
  armed: boolean;
  resetKey: string | number;
  onSubmit: (observations: readonly ProfileObservation[], opts?: RateOptions) => void;
}

/** Word Sync renders the canonical rating control; no local surface remains. */
export const WordSyncRating: Component<WordSyncRatingProps> = (props) => (
  <RatingMatrix
    capabilities={props.accesses}
    keyboardMode={props.keyboardMode}
    armed={props.armed}
    resetKey={props.resetKey}
    onSubmit={props.onSubmit}
  />
);
