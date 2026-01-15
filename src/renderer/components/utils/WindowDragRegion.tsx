import './WindowDragRegion.css';

type Props = {
    hidden?: boolean;
};

export function WindowDragRegion(props: Props) {
    return (
        <div
            class={`drag-region ${props.hidden ? 'hidden' : ''}`}
        />
    );
}