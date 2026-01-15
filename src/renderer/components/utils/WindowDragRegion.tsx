import { JSX } from 'solid-js';
import styles from './WindowDragRegion.module.css';


type Props = {
    hidden?: boolean; // used to fade out
};


export function WindowDragRegion(props: Props) {
    return <div
        class={styles["drag-region"]}
        classList={{[styles.hidden]: props.hidden}}
    />;
}