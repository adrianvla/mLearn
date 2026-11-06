import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';
import { Button } from '@mlearn/ui/button';
import { Menu } from '@mlearn/ui/menu';
import { SegmentedControl } from '@mlearn/ui/segmented-control';

type Destination = 'knowledge' | 'material' | 'review';

/** Collection peers stay in context; other activities remain available without a global rail. */
export function ActivityNavigation({ active, packageId, children }: {
  readonly active: Destination;
  readonly packageId?: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const compact = useWindowDimensions().width < 700;
  return <View style={styles.navigation}>
    <Button label="Home" icon="arrowLeft" iconOnly variant="quiet" size="compact"
      onPress={() => active === 'review' ? router.dismissTo('/') : router.navigate('/')} />
    {children}
    {!compact && active !== 'review' ? <View style={styles.collections}>
      <SegmentedControl value={active} options={[
        { value: 'knowledge', label: 'Knowledge' }, { value: 'material', label: 'Material' },
      ]} onValueChange={value => {
        if (value === 'knowledge') router.navigate({ pathname: '/knowledge', params: packageId ? { packageId } : {} });
        else if (value === 'material') router.navigate('/materials');
      }} />
    </View> : null}
    <Menu label="More destinations" icon="more" variant="quiet" actions={[
      ...(compact || active === 'review' ? [
        { id: 'knowledge', label: 'Knowledge', current: active === 'knowledge', onPress: () => {
          const destination = { pathname: '/knowledge' as const, params: packageId ? { packageId } : {} };
          if (active === 'review') router.dismissTo(destination);
          else router.navigate(destination);
        } },
        { id: 'material', label: 'Material', current: active === 'material', onPress: () =>
          active === 'review' ? router.dismissTo('/materials') : router.navigate('/materials') },
      ] : []),
      ...(active !== 'review' ? [{ id: 'review', label: 'Review', onPress: () =>
        router.push({ pathname: '/review', params: packageId ? { packageId } : {} }) }] : []),
      { id: 'conversation', label: 'Conversation', onPress: () => router.push('/messenger') },
      { id: 'settings', label: 'Settings', onPress: () => router.push('/settings') },
    ]} />
  </View>;
}

const styles = StyleSheet.create(theme => ({
  navigation: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center',
    gap: theme.spacing.small, minWidth: 0, maxWidth: '100%' },
  collections: { width: 220, minWidth: 0 },
}));
