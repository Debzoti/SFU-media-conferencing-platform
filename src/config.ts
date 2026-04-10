import {ChildProcess} from 'node:child_process';
import {types as mediasoupTypes} from 'mediasoup';

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
    rtpPort: number;
    startTime: Date;
    status: 'starting' | 'active' | 'stopping' | 'failed';
}