import { KeyboardAvoidingView as NativeKeyboardAvoidingView } from 'react-native';
import { withUnistyles } from 'react-native-unistyles';

// KeyboardAvoidingView owns transient height/flex/padding overrides. Binding
// its theme styles directly to the native shadow node reapplied flex:1 after
// Android calculated the correct keyboard height, hiding the composer again.
// Resolve styles at this boundary so its own layout remains authoritative.
// Remove this adaptation only when the native keyboard visibility regression
// passes with ordinary Unistyles style binding on both mobile platforms.
export const KeyboardAvoidingView = withUnistyles(NativeKeyboardAvoidingView);
