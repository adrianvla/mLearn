import type { ComponentProps } from 'react';
import type { LinguisticPresentation } from '@mlearn/contracts';
import type { InlineWord } from '@mlearn/ui/inline-word';

export type LinguisticVariant = 'subtitle' | 'body' | 'inspectionTitle';
export type LinguisticWordProps = {
    readonly text: string;
    /** Offsets are relative to text, which must be the untouched package source. */
    readonly presentation?: LinguisticPresentation | null;
    readonly variant?: LinguisticVariant;
    readonly activation?: Pick<ComponentProps<typeof InlineWord>, 'status' | 'inspectionMode' | 'onActivate'>;
};
