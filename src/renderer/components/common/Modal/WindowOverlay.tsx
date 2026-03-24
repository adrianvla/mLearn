import { createSignal, onCleanup, Show, JSX } from "solid-js";
import {WindowDragRegion} from "@renderer/components/utils/WindowDragRegion";

export type WindowOverlayProps = {
    children?: JSX.Element;
    idleTimeout?: number;
};

export function WindowOverlay(props: WindowOverlayProps) {
    const [active, setActive] = createSignal(false);
    let timer: number | undefined;

    const onMouseMove = () => {
        if (!active()) setActive(true);

        if (timer) clearTimeout(timer);
        timer = window.setTimeout(
            () => setActive(false),
            props.idleTimeout ?? 2000
        );
    };

    window.addEventListener("mousemove", onMouseMove);

    onCleanup(() => {
        window.removeEventListener("mousemove", onMouseMove);
        timer && clearTimeout(timer);
    });

    return (
        <>
            <WindowDragRegion hidden={!active()}/>
            <Show when={active()}>
                {props.children}
            </Show>
        </>
    );
}
