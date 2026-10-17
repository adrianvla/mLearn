// Specialist HTML media renderer: HTMLVideoElement owns codecs, transport,
// audio, scrubbing and accessible native controls. It owns no learner state.
import {useRef,useEffect} from 'react';
import type {MediaPlayerProps} from './MediaPlayer.types';
export function MediaPlayer({uri,initialPositionMs,paused,onProgress,onError,onController}:MediaPlayerProps){
 const ref=useRef<HTMLVideoElement>(null);
 useEffect(()=>{onController({subtitleBottomInset:64,pauseAndRead:()=>{const v=ref.current;v?.pause();return{positionMs:Math.round((v?.currentTime??0)*1000),durationMs:Math.round((v?.duration??0)*1000)};}});},[]);
 const callbacks=useRef({onProgress,onError});callbacks.current={onProgress,onError};
 useEffect(()=>{if(paused)ref.current?.pause();},[paused]);
 useEffect(()=>()=>{const video=ref.current;if(video){video.pause();callbacks.current.onProgress(video.currentTime*1000,video.duration*1000,true);}},[]);
 const progress=(checkpoint:boolean)=>{const v=ref.current;if(v && Number.isFinite(v.duration))callbacks.current.onProgress(Math.round(v.currentTime*1000),Math.round(v.duration*1000),checkpoint);};
 return <video ref={ref} src={uri} controls playsInline preload="metadata" aria-label="Local video player" style={{width:'100%',height:'100%',objectFit:'contain',background:'#000'}}
 onLoadedMetadata={()=>{if(ref.current){ref.current.currentTime=Math.min(initialPositionMs/1000,ref.current.duration);progress(false);}}}
 onTimeUpdate={()=>progress(false)} onSeeked={()=>progress(true)} onPause={()=>progress(true)} onEnded={()=>progress(true)}
 onError={()=>callbacks.current.onError(`This host could not decode the video (media error ${ref.current?.error?.code??'unknown'}). Select a compatible local video; saved progress is preserved.`)}/>;
}
