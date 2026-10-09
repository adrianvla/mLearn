import { Show } from 'solid-js';
import { isElectron, getOS } from '@shared/platform';
import './WindowDragRegion.css';

const isMacOS = isElectron() && getOS() === 'mac';

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