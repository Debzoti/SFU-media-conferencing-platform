import {ChildProcess} from 'node:child_process';
import {types as mediasoupTypes} from 'mediasoup';
import { HLSTranscoder } from 'src/media/hlsTranscoder';

export interface HLSConfig {
    segmentDuration: number;
    playlistSize: number;
    videoBitrate: string;
    videoPreset: string;
    gopSize: number;
    audioBitrate: string;
    outputDir: string;
    rtpPortStart: number;
    rtpPortEnd: number;
}

export interface Config {
    rtcMinPort: number;
    rtcMaxPort: number;
    httpPort: number;
    hls: HLSConfig;
}

export interface FFmpegConfig{
    
  videoRtpPort: number;      // e.g., 20000
  audioRtpPort: number;      // e.g., 20001
  videoBitrate: string;      // e.g., "1000k"
  segmentDuration: number;   // e.g., 4
  playlistSize: number;      // e.g., 6
  outputPattern: string;     // e.g., "public/hls/room-123-segment_%03d.ts"
  playlistPath: string;      // e.g., "public/hls/room-123-playlist.m3u8"
}

export interface StreamSession {
    roomId: string;
    producerId: string;
    plainTransport: mediasoupTypes.PlainTransport;
    ffmpegProcess: ChildProcess;
    trancoderInstance : HLSTranscoder;
    rtpPort: number;
    audioPort : number,
    startTime: Date;
    status: 'starting' | 'active' | 'stopping' | 'failed';
}

export interface HLSStreamAvailableMessege {
    type: 'hlsSteamAvailable';
    roomId : string;
    playlistUrl : string;
}

export interface HLSUnavailable{
    type: 'hlsUnavailable';
    roomId: string; 
}