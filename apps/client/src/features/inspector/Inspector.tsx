import {useState,useEffect} from 'react';
import {ContextPanel} from '@mlearn/ui/context-panel';import type {TextAnchor} from '@mlearn/ui/inline-word';
import {Text} from '@mlearn/ui/text';import {Row,Stack} from '@mlearn/ui/layout';import {Button} from '@mlearn/ui/button';
import type {LexicalEntry,KnowledgeProjection,ClaimChange} from '@mlearn/contracts';import type {RuntimeClient} from '@mlearn/runtime-client';
export type Inspection={sourceForm:string;context:string;targets:string[];anchor:TextAnchor};
export function Inspector({inspection,packageId,client,knowledge,onChanged,onClose}:{inspection:Inspection;packageId:string;client:RuntimeClient;knowledge:KnowledgeProjection[];onChanged:()=>Promise<void>;onClose:()=>void}){
 const [index,setIndex]=useState(0);const [entry,setEntry]=useState<LexicalEntry|null>(null);const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [retry,setRetry]=useState<ClaimChange|null>(null);const [lookupVersion,setLookupVersion]=useState(0);const [showKnowledge,setShowKnowledge]=useState(false);
 useEffect(()=>{let active=true;setError('');setEntry(null);client.inspectTarget(packageId,inspection.targets[index]).then(value=>{if(active)setEntry(value);}).catch(e=>{if(active)setError(String(e.message??e));});return()=>{active=false;};},[client,packageId,inspection.targets,index,lookupVersion]);
 async function commit(change:ClaimChange){setBusy(true);setError('');try{await client.changeClaim(change);setRetry(null);await onChanged();}catch(e){setError(e instanceof Error?e.message:String(e));setRetry(change);}finally{setBusy(false);}}
 return <ContextPanel title={entry?.headword??inspection.sourceForm} anchor={inspection.anchor} onClose={onClose}>
  {entry?<><Text>{entry.definition}</Text><Text muted variant="caption">{inspection.sourceForm} · {entry.partOfSpeech}</Text>
   <Row><Button label="‹" accessibilityLabel="Previous sense" variant="secondary" disabled={index===0||busy} onPress={()=>setIndex(i=>i-1)}/><Text variant="caption">Sense {index+1} of {inspection.targets.length}</Text><Button label="›" accessibilityLabel="Next sense" variant="secondary" disabled={index+1>=inspection.targets.length||busy} onPress={()=>setIndex(i=>i+1)}/></Row>
   <Text muted variant="caption">Alternative senses; no contextual disambiguation</Text>

   <Row><Button label="Knowledge" variant="secondary" onPress={()=>setShowKnowledge(v=>!v)} accessibilityState={{expanded:showKnowledge}}/></Row>
   {showKnowledge?entry.capabilities.map(cap=>{const projection=knowledge.find(p=>p.key.packageId===packageId&&p.key.targetId===entry.targetId&&p.key.capability===cap.id);return <Stack key={cap.id}>
    <Text>{cap.label} · {projection?.status.replaceAll('_',' ')??'untracked'}</Text><Row>
     <Button label="Known" accessibilityLabel={`Claim ${cap.label} known`} variant="secondary" disabled={busy} onPress={()=>void commit(client.prepareClaim({packageId,targetId:entry.targetId,capability:cap.id},true))}/>
     <Button label="Unknown" accessibilityLabel={`Claim ${cap.label} unknown`} variant="secondary" disabled={busy} onPress={()=>void commit(client.prepareClaim({packageId,targetId:entry.targetId,capability:cap.id},false))}/>
     <Button label="Withdraw" accessibilityLabel={`Withdraw ${cap.label} claim`} variant="secondary" disabled={busy||projection?.claim===null} onPress={()=>void commit(client.prepareClaim({packageId,targetId:entry.targetId,capability:cap.id},null))}/>
    </Row><Text muted variant="caption">Assessed: {projection?.assessed===null?'unmeasured':String(projection?.assessed)} · Prediction: {projection?.prediction===null?'unavailable':String(projection?.prediction)}</Text>
   </Stack>;}):<Text muted variant="caption">{entry.capabilities.map(cap=>`${cap.label}: ${knowledge.find(p=>p.key.targetId===entry.targetId&&p.key.capability===cap.id)?.status.replaceAll('_',' ')??'untracked'}`).join(' · ')}</Text>}<Text muted variant="caption">{entry.attribution}</Text></>:<Text>Loading entry…</Text>}
  {error?<><Text accessibilityRole="alert">{error}</Text><Button label={retry?'Retry claim':'Retry lookup'} disabled={busy} onPress={()=>retry?void commit(retry):setLookupVersion(v=>v+1)}/></>:null}
 </ContextPanel>;
}
