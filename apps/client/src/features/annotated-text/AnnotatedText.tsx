import {Text as NativeText} from 'react-native';
import {StyleSheet} from 'react-native-unistyles';
import {InlineWord,type TextAnchor} from '@mlearn/ui/inline-word';
import type {CueAnalysis,OccurrenceKnowledge,AnalyzedToken} from '@mlearn/contracts';
/** Presentation only. One native batch owns analysis and all target projections. */
export function AnnotatedText({analysis,rawText,annotations,onInspect}:{analysis:CueAnalysis|null;rawText:string;annotations:OccurrenceKnowledge[];onInspect:(token:AnalyzedToken,anchor:TextAnchor)=>void}){
 if(!analysis)return <NativeText style={styles.line}>{rawText}</NativeText>;
 return <NativeText accessible={false} style={styles.line}>{analysis.tokens.map(token=>token.targets.length?<InlineWord key={token.start} text={token.text} status={annotations.find(a=>a.cueIndex===analysis.cue.index&&a.tokenStart===token.start)?.status??'untracked'} onActivate={anchor=>onInspect(token,anchor)}/>:<NativeText key={token.start}>{token.text}</NativeText>)}</NativeText>;
}
const styles=StyleSheet.create(theme=>({line:{fontSize:26*theme.textScale,lineHeight:44*theme.textScale,color:theme.media.text,textAlign:'center',textShadowColor:theme.media.background,textShadowRadius:4,textShadowOffset:{width:0,height:1}}}));
