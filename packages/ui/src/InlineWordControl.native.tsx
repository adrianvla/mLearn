import {useRef} from 'react';
import {Text as NativeText} from 'react-native';
import {StyleSheet} from 'react-native-unistyles';
import type {TextAnchor} from "./InlineWord.types";
export function InlineWordControl({text,status,onActivate}:{text:string;status:string;onActivate:(anchor:TextAnchor)=>void}){
 const ref=useRef<NativeText>(null);
 const activate=()=>ref.current?.measureInWindow((x,y,width,height)=>onActivate({x,y,width,height,restoreFocus:()=>ref.current?.focus()}));
 return <NativeText ref={ref} accessible accessibilityRole="button" accessibilityLabel={`${text}: ${status.replaceAll('_',' ')}`} onPress={activate} style={styles.word(status)}>{text}</NativeText>;
}
const styles=StyleSheet.create(theme=>({word:(status:string)=>({fontSize:26*theme.textScale,lineHeight:44*theme.textScale,color:status==='claimed_known'?theme.colors.accent:theme.media.text,textDecorationLine:status==='claimed_unknown'||status==='mixed'?'underline':'none',textDecorationStyle:status==='mixed'?'dotted':'solid',_web:{cursor:'pointer',borderRadius:4}})}));
