import { types } from "mediasoup";
import { HLSConfig, StreamSession, FFmpegConfig } from "src/config/config";
import {types as mediasoupTypes} from "mediasoup";
import { HLSTranscoder } from "./hlsTranscoder";
import { ChildProcess } from "node:child_process";
import { readdir, unlink } from "node:fs/promises"; 
import path from "node:path";
import { validateHLSConfig } from "./mediaManager";
import { childLogger } from "src/tools/logger";
import { writeFileSync } from "node:fs";
import { RoomHlsPipeline } from 'src/rooms/roomHlsTypes';
import { WorkerManager } from './workerManager';


const log = childLogger('stream');

//helper function for building SDP files for mediasoup consumers
export function buildVideoSdp(videoRtpPort: number, consumer : mediasoupTypes.Consumer): string {
  const codec = consumer.rtpParameters.codecs[0];
  if(!codec) throw new Error(`no codec from consumer ${consumer.id}`);
  const videoCodec = codec.mimeType;
  const payloadType = codec.payloadType;
  const clockRate = codec.clockRate;

  return [
     'v=0',
     'o=- 0 0 IN IP4 127.0.0.1',
     's=mediasoup',
     'c=IN IP4 127.0.0.1',
     't=0 0',
     `m=video ${videoRtpPort} RTP/AVP ${payloadType}`,
     `a=rtpmap:${payloadType} ${videoCodec}/${clockRate}`,
     'a=recvonly',
   ].join('\r\n') + '\r\n';
  
}

export class StreamManager implements RoomHlsPipeline {
    private sessions : Map<string, StreamSession>;
    private config : HLSConfig;
    private nextRtpPort : number;
    private allocatedPorts : Set<number>;
    private availablePorts : number[];
    private producerLookup: (producerId: string) => mediasoupTypes.Producer<mediasoupTypes.AppData> | undefined;
    private workerManager: WorkerManager;
    private pendingStarts = new Set<string>();

    constructor(
        config: HLSConfig,
        producerLookup: (producerId: string) => mediasoupTypes.Producer<mediasoupTypes.AppData> | undefined,
        workerManager: WorkerManager
    ){
        this.config = validateHLSConfig(config);
        this.producerLookup = producerLookup;
        this.workerManager = workerManager;
        this.sessions = new Map<string,StreamSession>();
        this.nextRtpPort = config.rtpPortStart;
        this.availablePorts = [];
        for (let port = config.rtpPortStart; port <= config.rtpPortEnd; port++) {
            this.availablePorts.push(port);
        }
        this.allocatedPorts = new Set();
    }




    
    /**
     * Allocate a free RTP port from the pool
     */
    private allocateRtpPort(): number {
        // Get a port from available pool
        let availPort : number | undefined;
        if(this.availablePorts.length != 0){
            availPort = this.availablePorts.pop();
        }

        if (availPort === undefined) {
            throw new Error(`No available RTP ports (${this.allocatedPorts.size} in use)`);
        }

        // Save in allocated ports
        this.allocatedPorts.add(availPort);
        return availPort;
    }

    private async cleanupFiles(roomId:string) : Promise<void>{
        const outputDir = this.config.outputDir;

        try {
            
            //find and delete all matching segment files and unlink them to dlete them
            const files = await readdir(outputDir);
            const roomFileSegments = `room-${roomId}-`;
            const relatedFiles = files.filter( file => file.startsWith(roomFileSegments));
            
            for (const file of relatedFiles) {
                const fullPath = path.join(outputDir,file);
                try {
                    await unlink(fullPath);
                } catch (err) {
                    log.error({ err, fullPath }, 'failed to delete file');

                }
            }
        } catch (error) {
            log.error({ err: error, outputDir }, 'failed to read the dir');

        }

    }
    
    /**
     * Release an RTP port back to the pool
     */
    private releaseRtpPort(port: number): void {
        if (this.allocatedPorts.delete(port)) {
            this.availablePorts.push(port);
        }
    }

     getActiveSessions() : StreamSession[] {
        return Array.from(this.sessions.values()); 
    }

    getSTreamStatus(roomId : string) : StreamSession | null{
        return this.sessions.get(roomId) || null;
    }


    async start(roomId: string, sourceProducerId: string, generation: number): Promise<void> {
        // Synchronous claim BEFORE any await: concurrent starts cannot both pass.
        if (this.sessions.has(roomId) || this.pendingStarts.has(roomId)) {
            throw new Error(`HLS session already exists for room ${roomId}`);
        }
        this.pendingStarts.add(roomId);

        let videoRtpPort: number | undefined;
        let audioRtpPort: number | undefined;
        let plainTransport: mediasoupTypes.PlainTransport | undefined;
        let rtpConsumer: mediasoupTypes.Consumer | undefined;
        let transcoder: HLSTranscoder | undefined;

        try {
            const producer = this.producerLookup(sourceProducerId);
            if (!producer) {
                throw new Error(`video producer ${sourceProducerId} not found for HLS start`);
            }
            const router = this.workerManager.getRouter();

            videoRtpPort = this.allocateRtpPort();
            audioRtpPort = this.allocateRtpPort();

            plainTransport = await router.createPlainTransport({
                rtcpMux: true,
                comedia: false,
                listenInfo: { protocol: 'udp', ip: '127.0.0.1', announcedAddress: undefined },
            });
            await plainTransport.connect({ ip: '127.0.0.1', port: videoRtpPort });

            rtpConsumer = await plainTransport.consume({
                producerId: producer.id,
                rtpCapabilities: router.rtpCapabilities,
                paused: true,
            });

            const sdp = buildVideoSdp(videoRtpPort, rtpConsumer);
            const sdpPath = `${this.config.outputDir}/room-${roomId}.sdp`;
            writeFileSync(sdpPath, sdp);

            const ffmpegConfig: FFmpegConfig = {
                videoRtpPort: videoRtpPort,
                audioRtpPort: audioRtpPort,
                videoBitrate: this.config.videoBitrate,
                segmentDuration: this.config.segmentDuration,
                playlistSize: this.config.playlistSize,
                outputPattern: `${this.config.outputDir}/room-${roomId}-segment_%03d.ts`,
                playlistPath: `${this.config.outputDir}/room-${roomId}-playlist.m3u8`,
                sdpPath: `${this.config.outputDir}/room-${roomId}.sdp`,
            };
            transcoder = new HLSTranscoder(ffmpegConfig);
            const ffmpegProcess = transcoder.spawn();
            await rtpConsumer.resume();

            this.sessions.set(roomId, {
                roomId: roomId,
                producerId: producer.id,
                sourceConsumer: rtpConsumer,
                plainTransport: plainTransport,
                ffmpegProcess: ffmpegProcess,
                trancoderInstance: transcoder,
                rtpPort: videoRtpPort,
                audioPort: audioRtpPort,
                startTime: new Date(),
                status: 'active',
                generation: generation,
                terminatedByUs: false,
            });
            this.watchFfmpeg(roomId, ffmpegProcess);
            log.info({ roomId, sourceProducerId, videoRtpPort, generation }, 'HLS pipeline started');
        } catch (error) {
            // Teardown partial resources, then rethrow — honest rejection.
            if (transcoder) { try { await transcoder.terminate(); } catch { /* best effort */ } }
            rtpConsumer?.close();
            plainTransport?.close();
            if (videoRtpPort !== undefined) this.releaseRtpPort(videoRtpPort);
            if (audioRtpPort !== undefined) this.releaseRtpPort(audioRtpPort);
            try { await this.cleanupFiles(roomId); } catch { /* best effort */ }
            log.error({ err: error, roomId }, 'HLS start failed');
            throw error;
        } finally {
            this.pendingStarts.delete(roomId);
        }
    }

    async switchSource(roomId: string, sourceProducerId: string, generation: number): Promise<void> {
        const session = this.sessions.get(roomId);
        if (!session) {
            throw new Error(`cannot switch HLS source: no session for room ${roomId}`);
        }
        // Controlled restart: full teardown of the old pipeline, then a
        // fresh build for the new producer (playlist URL unchanged).
        await this.teardownSession(session);
        this.sessions.delete(roomId);
        await this.start(roomId, sourceProducerId, generation);
    }

    async stop(roomId: string, generation: number): Promise<void> {
        const session = this.sessions.get(roomId);
        if (!session) {
            log.info({ roomId, generation }, 'HLS stop requested but no session exists');
            return; // idempotent
        }
        session.status = 'stopping';
        await this.teardownSession(session);
        this.sessions.delete(roomId);
        log.info({ roomId, generation }, 'HLS pipeline stopped');
    }

    // Shared teardown for stop/switch: ffmpeg first (it holds files/ports),
    // then consumer, transport, ports, files.
    private async teardownSession(session: StreamSession): Promise<void> {
        session.terminatedByUs = true;
        try { await session.trancoderInstance.terminate(); } catch { /* best effort */ }
        session.sourceConsumer.close();
        session.plainTransport.close();
        this.releaseRtpPort(session.rtpPort);
        this.releaseRtpPort(session.audioPort);
        await this.cleanupFiles(session.roomId);
    }

    private watchFfmpeg(roomId: string, ffmpegProcess: ChildProcess): void {
        ffmpegProcess.on('exit', (code, signal) => {
            const session = this.sessions.get(roomId);
            if (session && !session.terminatedByUs) {
                session.status = 'failed';
                log.error({ roomId, code, signal }, 'ffmpeg crashed for room');
            } else {
                log.info({ roomId, code, signal }, 'ffmpeg exited (intentional)');
            }
        });
    }

}
