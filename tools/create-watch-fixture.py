"""Author synthetic video/subtitles/tone using installed platform tools, offline."""
from pathlib import Path
import subprocess,sys,wave,math,array,hashlib
output=Path(sys.argv[1]).resolve(); output.mkdir(parents=True,exist_ok=True)
if sys.platform=='darwin':
 samples=array.array('h',(int(3200*math.sin(2*math.pi*440*i/24000)) if i%24000<4800 else 0 for i in range(30*24000)))
 if sys.byteorder!='little':samples.byteswap()
 with wave.open(str(output/'watch-tone.wav'),'wb') as wav:
  wav.setparams((1,2,24000,0,'NONE','not compressed'));wav.writeframes(samples.tobytes())
 subprocess.run(['swift',str(Path(__file__).with_suffix('.swift')),str(output)],check=True)
else:
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=navy:s=640x360:r=30:d=30','-f','lavfi','-i','sine=frequency=440:sample_rate=24000:duration=30','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',str(output/'watch-fixture.mp4')],check=True)
 subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-i',str(output/'watch-fixture.mp4'),'-map','0','-c','copy','-metadata','title=mLearn Japanese fixture','-movflags','+faststart',str(output/'watch-japanese.mp4')],check=True)
# Native identity follows media bytes, not filenames. A renamed copy would
# replace the English source's package/subtitles and inherit its checkpoint.
with (output/'watch-fixture.mp4').open('rb') as english, (output/'watch-japanese.mp4').open('rb') as japanese:
 if hashlib.file_digest(english,'sha256').digest()==hashlib.file_digest(japanese,'sha256').digest():
  raise RuntimeError('English and Japanese acceptance media must have distinct content identities')
(output/'watch-fixture.srt').write_text('1\n00:00:00,000 --> 00:00:15,000\nChildren walked home.\n\n2\n00:00:15,000 --> 00:00:30,000\nChildren came\nhome.\n')
(output/'watch-japanese.srt').write_text('1\n00:00:00,000 --> 00:00:15,000\n昨日、つまり、明日。\n\n2\n00:00:15,000 --> 00:00:30,000\n今日、学校、友達。\n',encoding='utf-8')
print('Authored 30s H.264/AAC video, tone and matching external SRT; no corpus input')
