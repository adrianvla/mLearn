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
test('allows primitive implementation only in its owner', () => {
  assert.deepEqual(checkSource('packages/ui/src/Button.tsx', "import { Pressable } from 'react-native'; const A = () => <Pressable />;"), []);
});
test('prevents UI from importing runtime services', () => {
  assert.ok(checkSource('packages/ui/src/Button.tsx', "import { createClient } from '@mlearn/runtime-client';").length);
});
test('permits DOM in the specialist document package', () => {
  assert.deepEqual(checkSource('packages/reader-dom/src/Document.tsx', 'const A = () => <ruby>字<rt>じ</rt></ruby>;'), []);
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
