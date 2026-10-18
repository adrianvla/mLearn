use crate::{ProfileStore,StorageError};
use mlearn_core::{SourceRecord,KnowledgeKey,KnowledgeProjection,ClaimChange};
use rusqlite::{params,OptionalExtension};
use sha2::{Digest,Sha256};
impl ProfileStore {
 pub fn save_source(&self, source:&SourceRecord)->Result<(),StorageError> {
  self.connection.execute("INSERT INTO sources(id,document,touched) VALUES(?1,?2,unixepoch('subsec')) ON CONFLICT(id) DO UPDATE SET document=excluded.document,touched=excluded.touched",params![source.id,serde_json::to_string(source)?])?; Ok(())
 }
 pub fn source(&self,id:&str)->Result<SourceRecord,StorageError> {
  let json:String=self.connection.query_row("SELECT document FROM sources WHERE id=?1",[id],|r|r.get(0))?; Ok(serde_json::from_str(&json)?)
 }
 pub fn recents(&self)->Result<Vec<SourceRecord>,StorageError> {
  let mut stmt=self.connection.prepare("SELECT document FROM sources ORDER BY touched DESC,id LIMIT 20")?;
  let rows=stmt.query_map([],|r|r.get::<_,String>(0))?; rows.map(|r| Ok(serde_json::from_str(&r?)?)).collect()
 }
 pub fn knowledge(&self,keys:&[KnowledgeKey])->Result<Vec<KnowledgeProjection>,StorageError> {
  if keys.len()>256 {return Err(StorageError::Invalid("Knowledge batch exceeds 256 targets".into()));}
  let mut stmt=self.connection.prepare_cached("SELECT claim,revision FROM claims WHERE package_id=?1 AND target_id=?2 AND capability=?3")?;
  keys.iter().map(|key|{
   let row:Option<(Option<bool>,u32)>=stmt.query_row(params![key.package_id,key.target_id,key.capability],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
   let (claim,revision)=row.unwrap_or((None,0));
   // No assessment or prediction is fabricated from claims, exposure or absence.
   Ok(KnowledgeProjection{key:key.clone(),claim,assessed:None,prediction:None,revision,status:match claim {Some(true)=>"claimed_known",Some(false)=>"claimed_unknown",None=>"untracked"}.into()})
  }).collect()
 }
 pub fn change_claim(&mut self,change:&ClaimChange)->Result<KnowledgeProjection,StorageError> {
  if change.command_id.is_empty() || change.command_id.len()>128 || [&change.key.package_id,&change.key.target_id,&change.key.capability].iter().any(|v|v.is_empty() || v.len()>512) {return Err(StorageError::Invalid("Invalid claim identity".into()));}
  let digest=Sha256::digest(serde_json::to_vec(change)?).to_vec();
  let tx=self.connection.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
  let previous:Option<(Vec<u8>,String)>=tx.query_row("SELECT digest,projection FROM claim_receipts WHERE command_id=?1",[&change.command_id],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
  if let Some((old,result))=previous {
   if old!=digest {return Err(StorageError::Invalid("Command identity reused for different claim".into()));}
   return Ok(serde_json::from_str(&result)?);
  }
  tx.execute("UPDATE knowledge_revision SET revision=revision+1 WHERE id=1",[])?;
  let revision=tx.query_row("SELECT revision FROM knowledge_revision WHERE id=1",[],|r|r.get(0))?;
  tx.execute("INSERT INTO claims(package_id,target_id,capability,claim,revision) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(package_id,target_id,capability) DO UPDATE SET claim=excluded.claim,revision=excluded.revision",params![change.key.package_id,change.key.target_id,change.key.capability,change.claim,revision])?;
  let projection=KnowledgeProjection{key:change.key.clone(),claim:change.claim,assessed:None,prediction:None,revision,status:match change.claim {Some(true)=>"claimed_known",Some(false)=>"claimed_unknown",None=>"untracked"}.into()};
  tx.execute("INSERT INTO claim_receipts(command_id,digest,projection) VALUES(?1,?2,?3)",params![change.command_id,digest,serde_json::to_string(&projection)?])?;
  // Receipts live with durable commands: retry identity must survive restart.
  tx.commit()?; Ok(projection)
 }
}
impl ProfileStore {
 pub fn attach_cues(&mut self,source:&SourceRecord,cues:&[mlearn_core::Cue])->Result<(),StorageError>{
  let tx=self.connection.transaction()?;
  tx.execute("DELETE FROM cues WHERE source_id=?1",[&source.id])?;
  {let mut stmt=tx.prepare("INSERT INTO cues VALUES(?1,?2,?3,?4,?5)")?;
   for cue in cues {stmt.execute(params![source.id,cue.index,cue.start_ms,cue.end_ms,cue.text])?;}}
  tx.execute("UPDATE sources SET document=?2,touched=unixepoch('subsec') WHERE id=?1",params![source.id,serde_json::to_string(source)?])?;
  tx.commit()?;Ok(())
 }
 pub fn cue_window(&self,id:&str,time:u32)->Result<(Vec<mlearn_core::Cue>,u32),StorageError>{
  let count:u32=self.connection.query_row("SELECT COUNT(*) FROM cues WHERE source_id=?1",[id],|r|r.get(0))?;
  let anchor:u32=self.connection.query_row("SELECT COALESCE(MAX(cue_index),0) FROM cues WHERE source_id=?1 AND start_ms<=?2",params![id,time],|r|r.get(0))?;
  let mut stmt=self.connection.prepare("SELECT cue_index,start_ms,end_ms,text FROM cues WHERE source_id=?1 AND ((start_ms<=?3 AND end_ms>?3) OR (cue_index>=?2 AND cue_index<=?4)) ORDER BY cue_index LIMIT 17")?;
  let rows=stmt.query_map(params![id,anchor.saturating_sub(1),time,anchor.saturating_add(1)],|r|Ok(mlearn_core::Cue{index:r.get(0)?,start_ms:r.get(1)?,end_ms:r.get(2)?,text:r.get(3)?}))?.collect::<Result<Vec<_>,_>>()?;
  if rows.len()>16{return Err(StorageError::Invalid("Subtitle window exceeds 16 concurrent/context cues".into()));}
  Ok((rows,count))
 }
}

impl ProfileStore {
 pub fn find_source(&self,id:&str)->Result<Option<SourceRecord>,StorageError>{
  let json:Option<String>=self.connection.query_row("SELECT document FROM sources WHERE id=?1",[id],|r|r.get(0)).optional()?;
  json.map(|s|serde_json::from_str(&s).map_err(StorageError::from)).transpose()
 }
}
