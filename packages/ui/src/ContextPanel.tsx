import type {PropsWithChildren} from 'react';
import {Platform,View,Text as NativeText,ScrollView,useWindowDimensions} from 'react-native';
import * as Primitive from '@rn-primitives/dialog';
import {StyleSheet,useUnistyles} from 'react-native-unistyles';
import {Text} from './Text';import {Button} from './Button';import type {TextAnchor} from './InlineWord';
export function ContextPanel({title,anchor,onClose,children}:PropsWithChildren<{title:string;anchor:TextAnchor;onClose:()=>void}>){
 const {width,height}=useWindowDimensions();const {theme}=useUnistyles();
 const desktop=Platform.OS==='web' && width>=720;const panelWidth=Math.min(440,width-24);
 return <Primitive.Root open onOpenChange={open=>{if(!open)onClose();}}><Primitive.Portal><Primitive.Overlay asChild>
  <View style={styles.overlay}>
   <Primitive.Content asChild onCloseAutoFocus={event=>{event.preventDefault();anchor.restoreFocus();}}><View testID="inspector-panel" style={[styles.panel,{backgroundColor:theme.media.panel,borderColor:theme.media.border,borderRadius:theme.radius,width:panelWidth,maxHeight:Math.min(height-40,height*0.72)},desktop?{position:'absolute',left:Math.max(12,Math.min(width-panelWidth-12,anchor.x+anchor.width/2-panelWidth/2)),bottom:Math.max(16,height-anchor.y+12)}:{alignSelf:'center',marginBottom:20}]}>
    <View style={styles.header}><View style={styles.heading}><Primitive.Title asChild><NativeText style={styles.title}>{title}</NativeText></Primitive.Title></View><Primitive.Description asChild><Text tone="media" muted variant="caption">Inspect</Text></Primitive.Description><Button label="×" accessibilityLabel="Close Inspector" variant="media" size="compact" onPress={onClose}/></View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>{children}</ScrollView>
   </View></Primitive.Content>
  </View>
 </Primitive.Overlay></Primitive.Portal></Primitive.Root>;
}
const styles=StyleSheet.create(theme=>({overlay:{position:'absolute',top:0,left:0,right:0,bottom:0,justifyContent:'flex-end',backgroundColor:'transparent',_web:{position:'fixed',zIndex:1000}},panel:{padding:12,gap:6,borderWidth:1,_web:{backdropFilter:'blur(16px)',boxShadow:'0 8px 30px #00000055'}},header:{flexDirection:'row',alignItems:'center',gap:10},heading:{flex:1,minWidth:0},title:{color:theme.media.text,fontSize:24*theme.textScale,lineHeight:32*theme.textScale},body:{gap:8,paddingBottom:4}}));
