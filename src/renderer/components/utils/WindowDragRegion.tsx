import { Show } from 'solid-js';
import { isElectron } from '@shared/platform';
import './WindowDragRegion.css';

const isMacOS = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);

type Props = {
    hidden?: boolean;
};

export function WindowDragRegion(props: Props) {
    return (
        <Show when={isElectron() && isMacOS}>
            <div
                class={`drag-region ${props.hidden ? 'hidden' : ''}`}
            />
        </Show>
    );
}