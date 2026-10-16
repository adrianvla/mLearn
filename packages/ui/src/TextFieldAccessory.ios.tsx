import { InputAccessoryView, Keyboard, View } from 'react-native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import type {} from '@mlearn/theme/runtime';
import { Button } from './Button';

/** Multiline inputs keep Return for newlines and still offer explicit dismissal. */
export function TextFieldAccessory({ nativeID }: { nativeID: string }) {
  const { theme } = useUnistyles();
  return <InputAccessoryView nativeID={nativeID} backgroundColor={theme.colors.surface}>
    <View style={styles.bar}><Button label="Done" variant="secondary" onPress={Keyboard.dismiss} /></View>
  </InputAccessoryView>;
}
const styles = StyleSheet.create({
  bar: { padding: 8, alignItems: 'flex-end' },
});
