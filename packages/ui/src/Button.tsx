import { forwardRef } from 'react';
import { Platform, Pressable, Text, type PressableProps, type View } from 'react-native';
import styles from './Button.styles';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  busy?: boolean;
  size?: 'default' | 'compact';
  variant?: 'primary' | 'secondary' | 'quiet' | 'media' | 'pill';
  tone?: 'neutral' | 'positive' | 'negative';
};

export const Button = forwardRef<View, ButtonProps>(function Button({ label, busy = false, disabled = false, variant = 'primary', size = 'default', tone = 'neutral', accessibilityValue, ...props }, ref) {
  const blocked = disabled || busy;
  const selected = props.accessibilityState?.selected === true;
  const name = props.accessibilityLabel ?? label;
  return (
    <Pressable {...props} ref={ref} accessibilityRole="button"
      accessibilityLabel={Platform.OS === 'web' && accessibilityValue?.text ? `${name}: ${accessibilityValue.text}` : name}
      accessibilityValue={Platform.OS === 'web' ? undefined : accessibilityValue}
      accessibilityState={{ ...props.accessibilityState, disabled: blocked, busy }} disabled={blocked}
      style={({ pressed }) => [styles.root(variant, size, tone, selected), pressed && styles.pressed, blocked && styles.disabled]}>
      <Text style={styles.label(variant, size, tone)}>{selected ? '✓ ' : ''}{busy ? `${label}…` : label}</Text>
    </Pressable>
  );
});
