import {Component, createMemo, Show} from 'solid-js';
import {Dynamic} from 'solid-js/web';

import Anki from './raw/Anki';
import Bot from './raw/Bot';
import MLearnLogo from './raw/MLearnLogo';
import Cards from './raw/Cards';
import Check from './raw/Check';
import Chevron from './raw/Chevron';
import Cog from './raw/Cog';
import Cross from './raw/Cross';
import Cross2 from './raw/Cross2';
import Document from './raw/Document';
import FastForward from './raw/FastForward';
import Palette from './raw/Palette';
import Pause from './raw/Pause';
import Pin from './raw/Pin';
import Pip from './raw/Pip';
import Play from './raw/Play';
import Sidebar from './raw/Sidebar';
import Star from './raw/Star';
import Stars from './raw/Stars';
import Stats from './raw/Stats';
import Subtitles from './raw/Subtitles';
import Volume from './raw/Volume';
import {BookIcon, LinkIcon, TargetIcon} from "@/renderer";

interface IconProps {
    icon: string;
    color: string;
    class: string;
}

const iconMap = {
    anki: Anki,
    book: BookIcon,
    bot: Bot,
    cards: Cards,
    check: Check,
    chevron: Chevron,
    cog: Cog,
    cross: Cross,
    cross2: Cross2,
    document: Document,
    'fast-forward': FastForward,
    link:LinkIcon,
    'mlearn-logo': MLearnLogo,
    palette: Palette,
    pause: Pause,
    pin: Pin,
    pip: Pip,
    play: Play,
    sidebar: Sidebar,
    star: Star,
    stars: Stars,
    stats: Stats,
    subtitles: Subtitles,
    target: TargetIcon,
    volume: Volume,
};

const Icon: Component<IconProps> = (props) => {
    // Use createMemo to make the icon selection reactive
    const IconComponent = createMemo(() => iconMap[props.icon as keyof typeof iconMap]);

    return (
        <Show when={IconComponent()}>
            <Dynamic component={IconComponent()!} color={props.color} class={props.class} />
        </Show>
    );
};

export default Icon;