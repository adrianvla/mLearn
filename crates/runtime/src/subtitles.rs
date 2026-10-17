use mlearn_core::Cue;
/// M01 supports plain UTF-8 SRT. ASS/VTT/embedded track fidelity is M02.
pub fn parse(text:&str)->Result<Vec<Cue>,String>{
 if text.len()>2*1024*1024{return Err("SRT exceeds 2 MiB".into());}
 let normalized=text.trim_start_matches('\u{feff}').replace("\r\n","\n").replace('\r',"\n");
 let mut cues=Vec::new();
 for block in normalized.split("\n\n").filter(|b|!b.trim().is_empty()) {
  let mut lines=block.trim_matches('\n').lines();let number=lines.next().ok_or("Missing cue number")?;
  number.trim().parse::<u32>().map_err(|_|"Expected numbered SRT cue")?;
  let timing=lines.next().ok_or("Missing SRT timestamp")?;
  let (start,end)=timing.split_once("-->").ok_or("Expected SRT start --> end")?;
  let start_ms=timestamp(start)?;let end_ms=timestamp(end)?;
  if end_ms<=start_ms || cues.last().is_some_and(|c:&Cue| c.start_ms>start_ms){return Err("SRT timestamps must be ordered with positive duration".into());}
  let text=lines.collect::<Vec<_>>().join("\n");
  if text.is_empty() || text.len()>16384{return Err("SRT cue is empty or exceeds 16 KiB".into());}
  if text.contains('<') || text.contains('{'){return Err("Styled SRT is unavailable in M01; use plain-text SRT. Original file was not changed.".into());}
  cues.push(Cue{index:cues.len() as u32,start_ms,end_ms,text});
  if cues.len()>50000{return Err("SRT exceeds 50,000 cues".into());}
 }
 if cues.is_empty(){return Err("No SRT cues found".into());}Ok(cues)
}
fn timestamp(value:&str)->Result<u32,String>{
 let fields:Vec<_>=value.trim().split([':',',','.']).collect();
 if fields.len()!=4 || fields[3].len()!=3{return Err("Unsupported SRT timestamp".into());}
 let n=fields.iter().map(|v|v.parse::<u32>().map_err(|_|"Invalid SRT time".to_owned())).collect::<Result<Vec<_>,_>>()?;
 if n[0]>999 || n[1]>59 || n[2]>59 || n[3]>999{return Err("SRT time out of range".into());}
 Ok(((n[0]*60+n[1])*60+n[2])*1000+n[3])
}
#[cfg(test)]mod tests{use super::*;#[test]fn preserves_unicode_lines_and_rejects_partial_import(){let cues=parse("1\r\n00:00:01,001 --> 00:00:03,002\r\n👩🏽‍💻 café\r\nsecond line\r\n").unwrap();assert_eq!(cues[0].text,"👩🏽‍💻 café\nsecond line");assert_eq!(cues[0].start_ms,1001);assert!(parse("1\n00:00:03,000 --> 00:00:01,000\nbad").is_err());assert!(parse("1\n00:00:00,000 --> 00:00:01,000\nvalid\n\n2\nbroken\ninvalid").is_err());}}
