import { types } from "mediasoup";
import { HLSConfig, StreamSession, FFmpegConfig } from "src/config/config";
import {types as mediasoupTypes} from "mediasoup";
import { HLSTranscoder } from "./hlsTranscoder";
import { ChildProcess } from "node:child_process";
import { readdir, unlink } from "node:fs/promises"; 
import path from "node:path";
import { validateHLSConfig } from "./mediaManager";
import { childLogger } from "src/tools/logger";

const log = childLogger('stream');

export class StreamManager{
    private sessions : Map<string, StreamSession>;
    private config : HLSConfig;
    private nextRtpPort : number;
    private allocatedPorts : Set<number>;
    private availablePorts : number[];

    
    constructor(config:HLSConfig){
        this.config = validateHLSConfig(config);
        this.sessions = new Map<string,StreamSession>();
        this.config = config;
        this.nextRtpPort= config.rtpPortStart;
        this.availablePorts = [];
        //reuse and populate ports which are available
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

        /**
         * * clean up on ffmpeg failure
         * @param roomId
         */

    private async cleanupOnFailure(roomId: string) : Promise<void> {
        const session = this.sessions.get(roomId);
        if(!session) return;

        try {
            session.plainTransport.close();
            await this.cleanupFiles(roomId);
            this.releaseRtpPort(session.rtpPort);
            this.releaseRtpPort(session.audioPort);
            this.sessions.delete(roomId);
        } catch (error) {
            log.error({ err: error, roomId }, 'Error during cleanup');

        }
    
    }



    /**
     * * start the HLS streaming 
     * @param roomId 
     * @param producer 
     * @param router 
     */

    async startHLSStream(
        roomId:string,
        producer : mediasoupTypes.Producer<mediasoupTypes.AppData>,
        router: mediasoupTypes.Router<mediasoupTypes.AppData>
    ): Promise<void>{

        //check if already streaming 
        if(this.sessions.has(roomId)){
            log.info({ roomId }, 'Room already has HLS stream');
            return;
        }

        //get free rtp ports
        const videoRtpPort = this.allocateRtpPort();
        const audioRtpPort = this.allocateRtpPort();

        //create plaintransport
        const plainTransport = await router.createPlainTransport({
            rtcpMux : false,
            comedia:true, 
            listenInfo: {
                protocol: 'udp',
                ip: '127.0.0.1',
                announcedAddress: undefined
            }
        });

        //connect producer to plain transport
        await plainTransport.connect({
            ip: '127.0.0.1',
            port : videoRtpPort,
        });

        //create ffmpeg config
        //start ffmpeg
        const ffmpegConfig :  FFmpegConfig = {
            videoRtpPort : videoRtpPort,
            audioRtpPort:audioRtpPort,
            videoBitrate : this.config.videoBitrate,
            segmentDuration: this.config.segmentDuration,
            playlistSize : this.config.playlistSize,
            outputPattern : `${this.config.outputDir}/room-${roomId}-segment_%03d.ts`,
            playlistPath: `${this.config.outputDir}/room-${roomId}-playlist.m3u8`
        }
        const transcoder : HLSTranscoder = new HLSTranscoder(ffmpegConfig);
        const ffmpegProcess = transcoder.spawn();

        //save session
        this.sessions.set(roomId, {
            roomId : roomId,
            producerId : producer.id,
            plainTransport : plainTransport,
            ffmpegProcess : ffmpegProcess ,
            trancoderInstance : transcoder,
            rtpPort : videoRtpPort,
            audioPort : audioRtpPort,
            startTime : new Date(),
            status: 'active'
        });
        
        log.info({ roomId, videoRtpPort, audioRtpPort }, 'Started HLS stream for room');

        ffmpegProcess.on('exit', (code, signal) =>{
            log.error({ roomId, code, signal }, 'ffmpeg crashed for room, cleaning up');
            
            //update sessohns status
            const session = this.sessions.get(roomId);
            if(session){
                session.status = 'failed';
            }
        })
    }


    
    /**
     * * stop the HLS streaming 
     * @param roomId 
     */
    
    async stopHLSStream(roomId : string): Promise<void>{
        //get session
        const session = this.sessions.get(roomId);

        if(!session){
            log.info({ roomId }, 'no HLS stream found in the room');
            return;
        }
        //chnage the streamn status
        session.status = 'stopping';

        //terminate ffmpeg preocess
        let transcoder = session.trancoderInstance;
        await transcoder.terminate();

        //close plaintransport
        let plainTransport = session.plainTransport;
        plainTransport.close();
        
        //cleanup files
        await this.cleanupFiles(session.roomId);

        //release ports

        this.releaseRtpPort(session.rtpPort);
        this.releaseRtpPort(session.audioPort);
        //remove from map
        this.sessions.delete(roomId);

        log.info({ roomId }, 'stopped HLS streaming for room');

    }


    /**
     * * for cleaning up after ffmpeg crash 
     * things to clean are 
     */
    
}


