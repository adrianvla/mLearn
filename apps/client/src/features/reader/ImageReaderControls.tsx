import type { ImageReaderSettings } from '@mlearn/contracts';
import { Button } from '@mlearn/ui/button';
import { Select } from '@mlearn/ui/select';
import type { useImageReader } from './useImageReader';

const fits = [{ value: 'contain', label: 'Fit Page' }, { value: 'height', label: 'Fit Height' }, { value: 'width', label: 'Fit Width' }];
const spreads = [{ value: 'single', label: 'Single Page' }, { value: 'paired', label: 'Double Page' }];
const directions = [{ value: 'ltr', label: 'Pages L→R' }, { value: 'rtl', label: 'Pages R→L' }];
const textReason = 'Page layout applies to page images.';

/** Double Page joins the spread into one image (paired + collate). */
export function ImageLayoutControls({ reader, onBeforeAction }: {
    readonly reader: ReturnType<typeof useImageReader> | null;
    readonly onBeforeAction: () => void;
}) {
    const settings = reader?.settings;
    const disabled = !reader || !settings || reader.saving;
    const hint = reader ? undefined : textReason;
    function change(value: Partial<ImageReaderSettings>) {
        if (!reader) return;
        onBeforeAction(); void reader.changeSettings(value);
    }
    return <>
        <Select label="Image fit" size="compact" value={settings?.fit ?? 'height'} disabled={disabled}
            options={fits}
            onValueChange={value => { if (value === 'contain' || value === 'height' || value === 'width') change({ fit: value }); }} />
        <Select label="Page layout" size="compact" value={!settings || settings.paired ? 'paired' : 'single'} disabled={disabled}
            options={spreads}
            onValueChange={value => change(value === 'paired' ? { paired: true, collate: true } : { paired: false })} />
        <Select label="Page order" size="compact" value={settings?.direction ?? 'rtl'} disabled={disabled}
            options={directions}
            onValueChange={value => change({ direction: value === 'rtl' ? 'rtl' : 'ltr' })} />
        <Button label="First solo" accessibilityLabel="First page alone" variant="secondary" size="compact"
            disabled={disabled || !settings.paired} accessibilityHint={hint ?? (settings?.paired ? undefined : 'Available with Double Page.')}
            accessibilityState={{ selected: !!settings?.firstPageSingle, disabled: disabled || !settings.paired }}
            onPress={() => { if (settings) change({ firstPageSingle: !settings.firstPageSingle }); }} />
    </>;
}
