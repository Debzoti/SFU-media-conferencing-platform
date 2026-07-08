import { types as mediasoupTypes,createWorker } from "mediasoup";
import { childLogger } from "src/tools/logger";
import config from 'src/config/config.json' ;
import { Config } from "src/config/config";
import { HLSConfig } from "src/config/config";
const log = childLogger('media');
// let configData:Config = config as Config;
    const mediaCodecs = [
        {
            kind: 'audio',
            mimeType: 'audio/opus',
            clockRate: 48000,
            channels: 2 ,
            preferredPayloadType: 100,
            parameters: {
                "x-google-start-bitrate": 1000,
                },
            rtcpFeedback: [
                { type: "nack" },
                { type: "ccm", parameter: "fir" },
                { type: "goog-remb" }
            ],
            
        },{
            kind: 'video',
            mimeType: 'video/VP8',
            clockRate: 90000,
            preferredPayloadType: 101,
            parameters: {
                "x-google-start-bitrate": 1000,
                },
            rtcpFeedback: [
                { type: "nack" },
                { type: "nack", parameter: "pli" },
                { type: "ccm", parameter: "fir" },
                { type: "goog-remb" }
            ],
        }
    ]

export class WorkerManager{
  private worker!: mediasoupTypes.Worker<mediasoupTypes.AppData>;
  private router!: mediasoupTypes.Router;
  private configData!: Config;
  constructor(config : Config){
    this.configData = config;  
  }

  
  async init(): Promise<void> {
    this.worker = await createWorker({
        rtcMinPort: this.configData.rtcMinPort,
        rtcMaxPort: this.configData.rtcMaxPort,
        logLevel: 'warn',
    })

    this.worker.on('died', () => {
        log.fatal({ pid: this.worker.pid }, 'mediasoup worker died, exiting in 2 seconds');
        setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });

    //create a router
    this.router  = await this.worker.createRouter({
        mediaCodecs: mediaCodecs as mediasoupTypes.RtpCodecCapability[],
    })
  }

  getRouter(): mediasoupTypes.Router {
    return this.router;
  }

  getWorker(): mediasoupTypes.Worker {
    return this.worker;
  }
}