import {ChildProcess, spawn} from 'node:child_process';
import { FFmpegConfig } from 'src/config';

class HLSTranscoder{
    //credentials
    private process : ChildProcess | null = null;
    private config : FFmpegConfig; //lets change later

    constructor(config : any){
        this.config = config;
    }

    //start the ffmpeg arg process
    spawn() : ChildProcess | null{
        //build the ffpeg args 
        const args = this.buildFFmpegArgs();
        //execute ffmpeg
        this.process = spawn('ffmpeg',args); 

        //monitor the output and error handling 
        this.process.stdout?.on('data', (data) => {
            console.log(`FFMPEG: ${data}`);
        });

        this.process.stderr?.on('data', (data) => {
            console.log(`FFMPEG: ${data}`);
        });

        this.process?.on('exit', (code,signal) =>{
            console.log(`FFmpeg exited with code ${code} , signal ${signal}`);
            
        });

        return this.process;

    }

    private buildFFmpegArgs() : string[]{
        return [
            '-protocol_whitelist', 'file,rtp,udp',
            
            // Video input from mediasoup PlainTransport
            '-i', `rtp://127.0.0.1:${this.config.videoRtpPort}`,
            
            // Audio input from mediasoup PlainTransport
            '-i', `rtp://127.0.0.1:${this.config.audioRtpPort}`,
            
            // Video encoding
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-tune', 'zerolatency',
            '-b:v', this.config.videoBitrate,
            '-g', '48',  // GOP size
            
            // Audio encoding
            '-c:a', 'aac',
            '-b:a', '128k',
            
            // HLS output
            '-f', 'hls',
            '-hls_time', this.config.segmentDuration.toString(),
            '-hls_list_size', this.config.playlistSize.toString(),
            '-hls_flags', 'delete_segments+append_list',
            '-hls_segment_filename', this.config.outputPattern,
            
            // Output playlist
            this.config.playlistPath
        ];
        }


    // Stop FFmpeg gracefully
    async terminate(): Promise<void> {
        if (!this.process) return;
        
        return new Promise((resolve) => {
        this.process!.on('exit', () => {
            this.process = null;
            resolve();
        });
        
        // Send graceful termination signal
        this.process!.kill('SIGTERM');
        
        // Force kill after 5 seconds if still running
        setTimeout(() => {
            if (this.process) {
            this.process.kill('SIGKILL');
            }
        }, 5000);
        });
    }

    // Check if FFmpeg is running
    isRunning(): boolean {
        return this.process !== null && this.process.exitCode === null;
    }

    // Get exit code
    getExitCode(): number | null {
        return this.process?.exitCode ?? null;
    }
}

export { HLSTranscoder };