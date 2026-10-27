import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkSource } from './policy.mjs';

const feature = 'apps/client/src/features/welcome/WelcomeScreen.tsx';
const blocked = [
  ['DOM controls', 'export const A = () => <button>Go</button>;'],
  ['DOM containers', 'export const A = () => <div />;'],
  ['aliased native controls', "import { Pressable as Btn } from 'react-native';"],
  ['namespace native controls', "import * as RN from 'react-native'; const A = () => <RN.Pressable />;"],
  ['direct headless library', "import * as Dialog from '@rn-primitives/dialog';"],
  ['native UI bypass', "import { Button } from '@expo/ui/swift-ui';"],
  ['Tauri bypass', "import { invoke } from '@tauri-apps/api/core';"],
  ['dynamic Tauri bypass', "async function f() { return import('@tauri-apps/api/core'); }"],
  ['hidden re-export', "export { Pressable as Button } from 'react-native';"],
  ['aliased ordinary native text', "import { Text as Definition } from 'react-native'; const A = () => <Definition />;"],
  ['re-exported ordinary native text', "export { Text as Definition } from 'react-native';"],
  ['wildcard native re-export', "export * from 'react-native';"],
  ['default native import', "import Native from 'react-native'; const { Text: Definition } = Native;"],
  ['destructured native require', "const { Text: Definition } = require('react-native');"],
  ['destructured dynamic native import', "const { Text: Definition } = await import('react-native');"],
  ['aliased raw typography', "const metrics = { ['fontSize']: 20, lineHeight: 28 }; const definition = metrics;"],
  ['destructured raw typography', "const { size: fontSize } = metrics; const definition = { fontSize };"],
  ['renderer database', "import { openDatabaseSync } from 'expo-sqlite';"],
  ['renderer persistence', "localStorage.setItem('learner', '{}');"],
  ['clickable text', 'const A = () => <Text onPress={() => {}}>Go</Text>;'],
  ['private feature path', "import x from '@/features/review/model/internal';"],
  ['native runtime shortcut', "import Native from '../../host/createHost';"],
  ['raw React element', "const A = React.createElement('button', {});"],
];
for (const [name, source] of blocked) {
  test(`rejects ${name}`, () => assert.ok(checkSource(feature, source).length > 0));
}

test('allows ordinary shared composition', () => {
  assert.deepEqual(checkSource(feature, "import { View } from 'react-native'; import { Button } from '@mlearn/ui/button'; const A = () => <View><Button label=\"Go\" onPress={() => {}} /></View>;"), []);
});
test('allows shared text aliases, re-exports and source variants', () => {
  assert.deepEqual(checkSource(feature, `
    import { Text as Definition } from '@mlearn/ui/text';
    export { Text as Heading } from '@mlearn/ui/text';
    const A = () => <Definition variant="inspectionBody" tone="media" selectable>Meaning</Definition>;
  `), []);
});
test('allows layout aliases and type-only native text references', () => {
  assert.deepEqual(checkSource(feature, `
    import { View as Region, type TextProps } from 'react-native';
    const A = () => <Region />;
  `), []);
});
test('allows typography in the shared owner, not in feature styles', () => {
  assert.deepEqual(checkSource('packages/ui/src/InlineWordControl.native.tsx', `
    import { Text as NativeText } from 'react-native';
    const style = { fontSize: 26, lineHeight: 44, fontWeight: '400', fontFamily: 'system' };
    const A = () => <NativeText style={style} />;
  `), []);
});
test('allows primitive implementation only in its owner', () => {
  assert.deepEqual(checkSource('packages/ui/src/Button.tsx', "import { Pressable } from 'react-native'; const A = () => <Pressable />;"), []);
});
test('prevents UI from importing runtime services', () => {
  assert.ok(checkSource('packages/ui/src/Button.tsx', "import { createClient } from '@mlearn/runtime-client';").length);
});
test('permits document markup only in the actual specialist renderer and shared flow owner', () => {
  const markup = 'const A = () => <div role="document"><figure><img src={uri}/><figcaption>Source</figcaption></figure><span>Text</span></div>;';
  assert.deepEqual(checkSource('apps/client/src/features/reader/DocumentCanvas.tsx', markup), []);
  assert.deepEqual(checkSource('packages/ui/src/InlineWordDocument.tsx', 'const A = () => <section>{children}</section>;'), []);
  assert.deepEqual(checkSource('packages/ui/src/InlineWordDocument.tsx', 'const A = () => <figure><img src={uri}/><figcaption>Source</figcaption></figure>; const canvas = document.createElement("canvas");'), []);
  assert.ok(checkSource('packages/ui/src/InlineWordDocument.tsx', 'const A = () => <button>Read</button>;').length);
  assert.ok(checkSource('apps/client/src/features/reader/ReaderScreen.tsx', markup).length);
  assert.ok(checkSource('apps/client/src/features/reader/CanvasEscape.tsx', markup).length);
  assert.ok(checkSource('packages/reader-dom/src/Document.tsx', markup).length);
});

test('document boundary cannot become another control or runtime owner', () => {
  const file = 'apps/client/src/features/reader/DocumentCanvas.tsx';
  for (const source of [
    'const A = () => <button>Inspect</button>;',
    'const A = () => <span role="button" />;',
    'const A = () => <div onClick={inspect} />;',
    'const A = React.createElement("button", {});',
    'import { createRuntimeClient } from "@mlearn/runtime-client";',
    'import { useRuntime } from "../../bootstrap/RuntimeProvider";',
    'import { createHost } from "../../host/createHost";',
    'const dom = { unstable_useExpoModulesBridge: true };',
  ]) assert.ok(checkSource(file, source).length, source);
  assert.deepEqual(checkSource(file, 'import type { DocumentBlock } from "@mlearn/contracts"; const dom = { unstable_useExpoModulesBridge: false };'), []);
});

test('isolated document imports cannot eagerly initialize native themed widgets', () => {
  const file = 'packages/ui/src/Document.tsx';
  assert.deepEqual(checkSource(file, 'export { DocumentWord } from "./InlineWordDocument";'), []);
  for (const source of [
    'export { InlineWord as DocumentWord } from "./InlineWord";',
    'export * from "./PronunciationReading";',
    'import { StyleSheet as Styles } from "react-native-unistyles";',
    'const theme = require("./PronunciationReading");',
  ]) assert.ok(checkSource(file, source).length, source);
  assert.ok(checkSource('apps/client/src/features/reader/DocumentCanvas.tsx',
    'import { InlineWord } from "@mlearn/ui/inline-word";').length);
  assert.deepEqual(checkSource('apps/client/src/features/reader/DocumentCanvas.tsx',
    'import { DocumentWord } from "@mlearn/ui/document";'), []);
});

test('accepted document appearance payloads do not authorize feature-local typography', () => {
  const file = 'apps/client/src/features/reader/ReaderScreen.tsx';
  assert.deepEqual(checkSource(file, 'changeAppearance({ fontSize: Math.min(48, current + 2), lineHeight: 1.8 });'), []);
  for (const source of [
    'const style = { fontSize: 24 };',
    'const style = { ["fontSize"]: 24 };',
    'const { size: fontSize } = metrics; const style = { fontSize };',
    'changeAppearance({ fontSize: 24, backgroundColor: "red" });',
    'otherOwner({ fontSize: 24 });',
  ]) assert.ok(checkSource(file, source).length, source);
  assert.ok(checkSource(feature, 'changeAppearance({ fontSize: 24 });').length);
});

test('only accepted shared-font display data crosses the document WebView boundary', () => {
  const file = 'apps/client/src/features/reader/DocumentViewport.tsx';
  assert.deepEqual(checkSource(file, 'const A = () => <DocumentCanvas display={{ fontFamily: theme.typography.body._web.fontFamily }} />;'), []);
  assert.ok(checkSource(file, 'const A = () => <DocumentCanvas display={{ fontFamily: "custom" }} />;').length);
  assert.ok(checkSource(file, 'const styles = { fontFamily: theme.typography.body._web.fontFamily };').length);
  assert.ok(checkSource(feature, 'const A = () => <DocumentCanvas display={{ fontFamily: theme.typography.body._web.fontFamily }} />;').length);
});

test('image source permits measured geometry and crop gestures without becoming a control or host owner', () => {
  const file = 'apps/client/src/features/reader/ImageCanvas.tsx';
  assert.deepEqual(checkSource(file, `
    function textStyle(region, width, height) { return { fontSize: Math.min(width, height) }; }
    const A = () => <div role="document" style={{ fontFamily: display.fontFamily }}>
      <div data-source-image={resource} onPointerDown={beginCrop}><img src={uri}/></div>
      <div data-ocr-region={region.id} style={{ lineHeight: 1 }} />
    </div>;
    const canvas = document.createElement('canvas');
  `), []);
  for (const source of [
    'const A = () => <button>Inspect</button>;',
    'const A = () => <div onPointerDown={openInspector}>Word</div>;',
    'const A = () => <div data-source-image={resource} onClick={openInspector}>Word</div>;',
    'const A = () => <div data-source-image={resource} role="button">Word</div>;',
    'const A = () => <div style={{ fontSize: 20, lineHeight: 1 }}>Ordinary UI</div>;',
    'const A = () => <div style={{ fontFamily: "custom" }}>Ordinary UI</div>;',
    'const button = document.createElement("button");',
    'import { createRuntimeClient } from "@mlearn/runtime-client";',
    'export { useRuntime as pixels } from "../../bootstrap/RuntimeProvider";',
    'const dom = { unstable_useExpoModulesBridge: true };',
  ]) assert.ok(checkSource(file, source).length, source);
  assert.ok(checkSource('apps/client/src/features/reader/ImageCanvasEscape.tsx',
    'const A = () => <div data-source-image={resource} onPointerDown={beginCrop}/>;').length);
});

test('image viewport forwards only the shared source text role', () => {
  const file = 'apps/client/src/features/reader/ImageViewport.tsx';
  assert.deepEqual(checkSource(file,
    'const A = () => <ImageCanvas display={{ fontFamily: theme.typography.body._web.fontFamily }} />;'), []);
  assert.ok(checkSource(file, 'const A = () => <ImageCanvas display={{ fontFamily: "custom" }} />;').length);
});

test('only the actual media and inline-control rendering boundaries admit specialist DOM',()=>{
 const video='export const Player=()=> <video controls />;';
 assert.equal(checkSource('apps/client/src/host/MediaPlayer.web.tsx',video).length,0);
 assert.ok(checkSource('apps/client/src/features/watch/WatchScreen.tsx',video).length);
 assert.equal(checkSource('packages/ui/src/InlineWordControl.web.tsx','export const Word=()=> <button>word</button>;').length,0);
 assert.ok(checkSource('packages/ui/src/ButtonEscape.tsx','export const Word=()=> <button>word</button>;').length);
 assert.equal(checkSource('apps/client/src/host/createHost.native.ts',"import {File} from 'expo-file-system';").length,0);
 assert.ok(checkSource('apps/client/src/host/createHost.native.ts',"import {openDatabaseSync} from 'expo-sqlite';").length);
});

test('inline star geometry is an inert theme-free rendering boundary, not another control owner',()=>{
 const file='packages/ui/src/LevelStars.web.tsx';
 assert.deepEqual(checkSource(file,'import { useRef } from "react"; import { LEVEL_STARS } from "./LevelStars.types"; const A=()=> <span role="img"><svg><path d={path}/></svg></span>;'),[]);
 assert.deepEqual(checkSource('packages/ui/src/InlineWordElement.web.tsx','import { LevelStars } from "./LevelStars.web";'),[]);
 for(const source of [
  'const A=()=> <button>word</button>;',
  'const A=()=> <span role="button"/>;',
  'const A=()=> <span onClick={activate}/>;',
  'const A=()=> React.createElement("button",{});',
  'import { StyleSheet } from "react-native-unistyles";',
  'export * from "./PronunciationReading";',
  'const theme=require("./PronunciationReading");',
 ]) assert.ok(checkSource(file,source).length,source);
 assert.ok(checkSource('packages/ui/src/StarEscape.web.tsx','const A=()=> <svg><path/></svg>;').length);
});
