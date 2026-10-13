import { forwardRef } from 'react';
import { Pressable, Text, type PressableProps, type View } from 'react-native';
import styles from './Button.styles';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  busy?: boolean;
  variant?: 'primary' | 'secondary';
};

export const Button = forwardRef<View, ButtonProps>(function Button({ label, busy = false, disabled = false, variant = 'primary', ...props }, ref) {
  const blocked = disabled || busy;
  return (
    <Pressable {...props} ref={ref} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel ?? label}
      accessibilityState={{ ...props.accessibilityState, disabled: blocked, busy }} disabled={blocked}
      style={[styles.root(variant), blocked && styles.disabled]}>
      <Text style={styles.label(variant)}>{busy ? `${label}…` : label}</Text>
    </Pressable>
  );
});
