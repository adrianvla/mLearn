import {useRef} from 'react';
import {Pressable,Text as NativeText,View,AccessibilityInfo,findNodeHandle} from 'react-native';
import {StyleSheet} from 'react-native-unistyles';
import type {TextAnchor} from './InlineWord.types';
/** A real inline view keeps each word independently reachable by TalkBack/VoiceOver.
 * Nested NativeText onPress works by touch but collapses into its parent's AX node.
 */
export function InlineWordControl({text,status,onActivate}:{text:string;status:string;onActivate:(anchor:TextAnchor)=>void}){
 const ref=useRef<View>(null);
 const restoreFocus=()=>{const tag=findNodeHandle(ref.current);if(tag)AccessibilityInfo.setAccessibilityFocus(tag);};
 const activate=()=>ref.current?.measureInWindow((x,y,width,height)=>onActivate({x,y,width,height,restoreFocus}));
 return <Pressable ref={ref} accessible accessibilityRole="button" accessibilityLabel={`${text}: ${status.replaceAll('_',' ')}`} onPress={activate} style={styles.target}><NativeText style={styles.word(status)}>{text}</NativeText></Pressable>;
}
const styles=StyleSheet.create(theme=>({target:{minHeight:44,flexDirection:'row',alignItems:'center'},word:(status:string)=>({fontSize:26*theme.textScale,lineHeight:44*theme.textScale,textShadowColor:theme.media.background,textShadowRadius:4,textShadowOffset:{width:0,height:1},color:status==='claimed_known'?theme.colors.accent:theme.media.text,textDecorationLine:status==='claimed_unknown'||status==='mixed'?'underline':'none',textDecorationStyle:status==='mixed'?'dotted':'solid'})}));
