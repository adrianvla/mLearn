import { Show } from 'solid-js';
import { isElectron } from '@shared/platform';
import './WindowDragRegion.css';

type Props = {
    hidden?: boolean;
};

export function WindowDragRegion(props: Props) {
    return (
        <Show when={isElectron()}>
            <div
                class={`drag-region ${props.hidden ? 'hidden' : ''}`}
            />
        </Show>
    );
}