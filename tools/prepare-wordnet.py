"""Pinned public WordNet 3.0 → a generic indexed resource. No private media input."""
from pathlib import Path
import hashlib, tarfile, sqlite3, json
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from typing import Final

root=Path(__file__).resolve().parent.parent
url='https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz'
expected='640db279c949a88f61f851dd54ebbb22d003f8b90b85267042ef85a3781d3a52'
archive_size: Final = 11537239
# Official pkgsrc distribution endpoints, verified against the upstream gzip pin.
sources: Final = (
    'https://cdn.netbsd.org/pub/pkgsrc/distfiles/WordNet-3.0.tar.gz',
    'https://ftp.netbsd.org/pub/pkgsrc/distfiles/WordNet-3.0.tar.gz',
    url,
)
request_seconds: Final = 120


def verified_archive(path: Path) -> bool:
    """Accept only the exact pinned upstream archive, including cached copies."""
    return (path.stat().st_size == archive_size
            and hashlib.sha256(path.read_bytes()).hexdigest() == expected)


def acquire_archive(archive: Path, existing: Path, offline: bool) -> None:
    """Stage each source beside the cache and publish only verified bytes."""
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        if verified_archive(archive):
            return
        print(f'WordNet cache rejected: {archive} (expected SHA256 {expected})', file=sys.stderr)
    with TemporaryDirectory(prefix='.wordnet-source-', dir=archive.parent) as directory:
        part = Path(directory) / archive.name
        if existing.exists():
            shutil.copyfile(existing, part)
            if verified_archive(part):
                part.replace(archive)
                return
            print(f'WordNet source rejected: {existing} (expected SHA256 {expected})', file=sys.stderr)
        if offline:
            raise SystemExit('Verified WordNet source missing: run npm run prepare:language-data once, then retry offline')
        for source in sources:
            print(f'WordNet acquiring: {source} (10s connect, {request_seconds}s transfer limit)', file=sys.stderr)
            try:
                # curl bounds the whole transfer (not just individual socket reads).
                # Built-in sources are HTTPS; redirects cannot downgrade to HTTP.
                subprocess.run(
                    ['curl', '--disable', '--fail', '--location', '--silent', '--show-error',
                     '--proto', '=http,https', '--proto-redir', '=https', '--max-redirs', '3',
                     '--connect-timeout', '10', '--max-time', str(request_seconds),
                     '--max-filesize', str(archive_size), '--output', str(part), source],
                    check=True, capture_output=True, text=True, timeout=request_seconds + 5,
                )
            except subprocess.CalledProcessError as error:
                print(f'WordNet source failed: {source}: {error.stderr.strip()}', file=sys.stderr)
                continue
            except subprocess.TimeoutExpired:
                print(f'WordNet source failed: {source}: exceeded {request_seconds + 5}s process limit', file=sys.stderr)
                continue
            except OSError as error:
                raise SystemExit(f'Cannot run curl for WordNet acquisition: {error}') from error
            if not verified_archive(part):
                print(f'WordNet source rejected: {source}: size={part.stat().st_size}, '
                      f'SHA256={hashlib.sha256(part.read_bytes()).hexdigest()}, expected={expected}',
                      file=sys.stderr)
                continue
            part.replace(archive)
            print(f'WordNet source verified: {source} ({archive_size} bytes, SHA256 {expected})', file=sys.stderr)
            return
    raise SystemExit('All pinned WordNet sources failed; no archive was published')


if __name__ == '__main__':
 cache=root/'.mlearn/package-sources'
 archive=cache/'WordNet-3.0.tar.gz'
 acquire_archive(archive, root/'.mlearn/m01/WordNet-3.0.tar.gz', '--offline' in sys.argv)
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
    value={'pos':pos,'definition':definition.strip(),'words':words}
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
