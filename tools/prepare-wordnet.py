"""Pinned public WordNet 3.0 → a generic indexed resource. No private media input."""
from pathlib import Path
import hashlib, urllib.request, tarfile, sqlite3, json
root=Path(__file__).resolve().parent.parent
cache=root/'.mlearn/package-sources'; cache.mkdir(parents=True,exist_ok=True)
archive=cache/'WordNet-3.0.tar.gz'
url='https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz'
expected='640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52'
if not archive.exists():
 existing=root/'.mlearn/m01/WordNet-3.0.tar.gz'
 if existing.exists(): archive.write_bytes(existing.read_bytes())
 else:
  if '--offline' in __import__('sys').argv: raise SystemExit('WordNet source missing: run npm run prepare:language-data once, then retry offline')
  urllib.request.urlretrieve(url,archive)
assert hashlib.sha256(archive.read_bytes()).hexdigest()==expected,'WordNet download digest mismatch'
destination=root/'target/wordnet/lexicon-v1.sqlite'; destination.parent.mkdir(parents=True,exist_ok=True)
recipe=hashlib.sha256(Path(__file__).read_bytes()+(root/'language-plugins/english/WordNet-LICENSE.txt').read_bytes()).hexdigest()
receipt=destination.with_suffix('.recipe.json')
if destination.exists() and receipt.exists():
 saved=json.loads(receipt.read_text())
 if saved.get('recipe')==recipe and saved.get('sha256')==hashlib.sha256(destination.read_bytes()).hexdigest():
  print('Using verified pinned WordNet resource'); raise SystemExit()
temporary=destination.with_suffix('.part'); temporary.unlink(missing_ok=True)
db=sqlite3.connect(temporary)
db.execute('CREATE TABLE resource_entries(key TEXT PRIMARY KEY,value BLOB NOT NULL) WITHOUT ROWID')
lemmas={}; count=0
with tarfile.open(archive) as tar:
 for pos in ['noun','verb','adj','adv']:
  for line in tar.extractfile('WordNet-3.0/dict/data.'+pos).read().decode().splitlines():
   if not line or not line[0].isdigit(): continue
   data,definition=line.split('|',1); fields=data.split(); offset,_,tag,n=fields[:4]
   words=[fields[4+i*2].replace('(a)','').replace('(p)','').replace('(ip)','') for i in range(int(n,16))]
   value={'pos':pos,'definition':definition.strip()}
   db.execute('INSERT INTO resource_entries VALUES(?,?)',('sense/'+tag+':'+offset,json.dumps(value,separators=(',',':')).encode()))
   for word in words:
    target=f'wn30:{tag}:{offset}:{word}'
    lemmas.setdefault(word.lower(),[]).append(target); count+=1
  for line in tar.extractfile('WordNet-3.0/dict/'+pos+'.exc').read().decode().splitlines():
   values=line.split()
   key='exception/'+pos+'/'+values[0]
   previous=db.execute('SELECT value FROM resource_entries WHERE key=?',(key,)).fetchone()
   merged=list(dict.fromkeys((json.loads(previous[0]) if previous else [])+values[1:]))
   db.execute('INSERT OR REPLACE INTO resource_entries VALUES(?,?)',(key,json.dumps(merged,separators=(',',':')).encode()))
 for lemma,targets in sorted(lemmas.items()):
  db.execute('INSERT INTO resource_entries VALUES(?,?)',('lemma/'+lemma,json.dumps(list(dict.fromkeys(targets)),separators=(',',':')).encode()))
 db.execute('INSERT INTO resource_entries VALUES(?,?)',('metadata',json.dumps({'schemaVersion':1,'source':url,'sha256':expected,'entries':count,'lemmas':len(lemmas),'license':(root/'language-plugins/english/WordNet-LICENSE.txt').read_text()}).encode()))
db.commit(); db.execute('VACUUM'); db.close(); temporary.rename(destination)
receipt.write_text(json.dumps({'recipe':recipe,'sha256':hashlib.sha256(destination.read_bytes()).hexdigest()}))
print(f'WordNet: {count} lexical senses, {len(lemmas)} lemmas, {destination.stat().st_size} bytes')
