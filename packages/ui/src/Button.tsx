import { forwardRef, useState } from 'react';
import { Platform, Pressable, Text, type PressableProps, type View } from 'react-native';
import { useUnistyles } from 'react-native-unistyles';
import styles, { buttonForeground, type ButtonVariant, type ButtonTone, type ButtonSize } from './Button.styles';
import { Icon, type IconName } from './Icon';

export type ButtonProps = Omit<PressableProps, 'children' | 'style'> & {
  label: string;
  busy?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
  tone?: ButtonTone;
  icon?: IconName;
  iconOnly?: boolean;
  iconPosition?: 'leading' | 'trailing';
};

export const Button = forwardRef<View, ButtonProps>(function Button({ label, busy = false, disabled = false, variant = 'primary', size = 'default', tone = 'neutral', icon, iconOnly = false, iconPosition = 'leading', accessibilityValue, accessibilityRole = 'button', onHoverIn, onHoverOut, ...props }, ref) {
  const { theme } = useUnistyles();
  const [hovered, setHovered] = useState(false);
  const blocked = disabled || busy;
  const selected = props.accessibilityState?.selected === true;
  const name = props.accessibilityLabel ?? label;
  return (
    <Pressable {...props} ref={ref} accessibilityRole={accessibilityRole}
      onHoverIn={event => { setHovered(true); onHoverIn?.(event); }}
      onHoverOut={event => { setHovered(false); onHoverOut?.(event); }}
      accessibilityLabel={Platform.OS === 'web' && accessibilityValue?.text ? `${name}: ${accessibilityValue.text}` : name}
      accessibilityValue={Platform.OS === 'web' ? undefined : accessibilityValue}
      accessibilityState={{ ...props.accessibilityState, disabled: blocked, busy }} disabled={blocked}
      style={({ pressed }) => [styles.root(variant, size, tone, selected, iconOnly),
        hovered && !blocked && styles.hover(variant, tone), pressed && styles.pressed, blocked && styles.disabled]}>
      {icon && iconPosition === 'leading' ? <Icon name={icon} size={size === 'default' ? 20 : 18} color={buttonForeground(theme, variant, tone)} /> : null}
      {!iconOnly ? <Text style={styles.label(variant, size, tone)}>{selected && variant !== 'navigation' ? '✓ ' : ''}{busy ? `${label}…` : label}</Text> : null}
      {icon && iconPosition === 'trailing' ? <Icon name={icon} size={size === 'default' ? 20 : 18} color={buttonForeground(theme, variant, tone)} /> : null}
    </Pressable>
  );
});
