import { useRouter } from 'expo-router';
import { Image, View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@mlearn/ui/button';
import { Text } from '@mlearn/ui/text';
import { logoSource } from '@mlearn/ui/brand';

type Destination = 'home' | 'knowledge' | 'material' | 'review';

/** Stable destinations around collection work; activity screens own their exits. */
export function WorkspaceNavigation({ active, packageId }: {
  readonly active: Destination;
  readonly packageId?: string;
}) {
  const router = useRouter();
  const compact = useWindowDimensions().width < 700;
  return <View style={styles.navigation(compact)}>
    {!compact ? <View style={styles.brand}>
      <Image source={logoSource} style={styles.logo} accessibilityLabel="mLearn Logo" />
      <Text variant="shellTitle">mLearn</Text>
    </View> : null}
    <Button label="Home" variant="navigation" size="compact"
      accessibilityState={{ selected: active === 'home' }}
      onPress={() => active === 'review' ? router.dismissTo('/') : router.navigate('/')} />
    <Button label="Review" testID={active === 'home' ? 'home-open-review' : undefined}
      icon={compact ? undefined : 'book'} variant="navigation" size="compact"
      accessibilityState={{ selected: active === 'review' }}
      onPress={() => router.push({ pathname: '/review', params: packageId ? { packageId } : {} })} />
    <Button label="Conversation" testID={active === 'home' ? 'home-open-conversation' : undefined}
      icon={compact ? undefined : 'conversation'} variant="navigation" size="compact"
      onPress={() => router.push('/messenger')} />
    {!compact ? <View style={styles.divider} /> : null}
    <Button label="Knowledge" variant="navigation" size="compact"
      accessibilityState={{ selected: active === 'knowledge' }}
      onPress={() => {
        const destination = { pathname: '/knowledge' as const, params: packageId ? { packageId } : {} };
        if (active === 'review') router.dismissTo(destination);
        else router.navigate(destination);
      }} />
    <Button label="Material" variant="navigation" size="compact"
      accessibilityState={{ selected: active === 'material' }}
      onPress={() => active === 'review' ? router.dismissTo('/materials') : router.navigate('/materials')} />
    {!compact ? <View style={styles.spacer} /> : null}
    <Button label="Settings" icon={compact ? undefined : 'settings'} variant="navigation" size="compact"
      onPress={() => router.push('/settings')} />
  </View>;
}

const styles = StyleSheet.create(theme => ({
  navigation: (compact: boolean) => ({
    flexGrow: compact ? 0 : 1, flexDirection: compact ? 'row' : 'column',
    gap: theme.spacing.tiny, minWidth: 0,
  }),
  brand: { flexDirection: 'row', alignItems: 'center', gap: theme.spacing.small,
    paddingHorizontal: theme.spacing.small, paddingBottom: theme.spacing.large },
  logo: { width: 24, height: 24 },
  divider: { height: 1, backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.medium, marginHorizontal: theme.spacing.small },
  spacer: { flexGrow: 1, minHeight: theme.spacing.section },
}));
