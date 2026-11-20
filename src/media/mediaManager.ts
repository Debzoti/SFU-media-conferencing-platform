// import mediasoup ,
// {
//     Worker,
//     Router,
//     Producer,Consumer,RtpParameters,
//     WebRtcTransport,
// }from 'mediasoup/node/lib/types';

import { types as mediasoupTypes,createWorker } from "mediasoup";

import config from 'src/config/config.json' ;
import {Config, HLSConfig, HLSStreamAvailableMessege, HLSUnavailable} from 'src/config/config' ;
import { StreamManager } from "./streamManager";
import path from 'path';

import { childLogger } from "src/tools/logger";
import { WorkerManager } from "./workerManager";
import { TransportManager } from "./transportManager";
import { ProducerManager } from "./producerManager";
import { ConsumerManager } from "./consumerManager";
import type { WebSocketServer } from 'ws';
import { RoomManager } from 'src/rooms/roomManager';
import { RoomHlsCoordinator } from 'src/rooms/roomHlsCoordinator';
import { RoomHlsNotifierAdapter } from './hlsNotifier';

const log = childLogger('media');

let configData:Config = config as Config;

// Resolve outputDir to absolute path
const hlsConfig: HLSConfig = {
    ...configData.hls,
    outputDir: path.join(process.cwd(), configData.hls.outputDir)
};


let streamManager : StreamManager ;
let workerManager: WorkerManager;
/*

                        +--------------------+
                    |     wsId: "peer1"  |
                    +--------------------+
                            | (owns)
                            v
            +-------------------------------------+
            | peerTransports                      |
            |  "peer1" -> [t1, t2]                |
            +-------------------------------------+
                    |                 |
                    v                 v
            +----------------+   +----------------+
            | transports     |   | transports     |
            |  t1 -> object  |   |  t2 -> object  |
            +----------------+   +----------------+
                    |
                    |  (used to produce audio/video)
                    v
            +--------------------+
            | producers          |
            |  p1 -> ProducerObj |
            |  p2 -> ProducerObj |
            +--------------------+
                    |
                    |  (who owns each producer?)
                    v
            +--------------------------+
            | producerOwner            |
            |  p1 -> "peer1"           |
            |  p2 -> "peer1"           |
            +--------------------------+

*/





//initialize the media manager

async function initApp(signalling: { wss: WebSocketServer; rooms: { [roomId: string]: { id: string; name: string }[] } }) {

  //use the workerManager instance and pull router
  workerManager = new WorkerManager(config)
  await workerManager.init();

  //calling the transport manager instance
  const transportManager = new TransportManager(workerManager);

  let producerManager: ProducerManager;
  const streamManager = new StreamManager(
      hlsConfig,
      (producerId) => producerManager?.getVideoProducer(producerId),
      workerManager
  );
  producerManager = new ProducerManager(transportManager, workerManager);

  //calling the consumer manager instance
  const consumerManager = new ConsumerManager(workerManager, transportManager);

  // Room-owned HLS state machine: coordinator drives start/switch/stop, producerManager emits events.
  const roomManager = new RoomManager();
  const notifier = new RoomHlsNotifierAdapter(signalling.wss, signalling.rooms);
  const hlsCoordinator = new RoomHlsCoordinator(roomManager, producerManager, streamManager, notifier);
  producerManager.hlsCoordinator = hlsCoordinator; // phase 2 — breaks the cycle

  return { transportManager, streamManager, producerManager, workerManager, consumerManager, hlsCoordinator };
    
}

//tesing 
async function getRouterRtpCapabilites(){
    if(!workerManager.getRouter()){
        log.error('Router not initialized');

        throw new Error('Router not initialized');
    }
    return workerManager.getRouter().rtpCapabilities;
}












    function validateHLSConfig(config : HLSConfig) : HLSConfig{
        const defaults = {
        "segmentDuration": 4,
        "playlistSize": 6,
        "videoBitrate": "1000k",
        "videoPreset": "veryfast",
        "gopSize": 48,
        "audioBitrate": "128k",
        "outputDir": "public/hls",
        "rtpPortStart": 20000,
        "rtpPortEnd": 20100
        };

            //validarte segment duration
        if(!config.segmentDuration || config.segmentDuration <=0){
            log.warn({ segmentDuration: config.segmentDuration, default: defaults.segmentDuration }, 'Invalid segment duration, using default');
            config.segmentDuration = defaults.segmentDuration;
        }

        // Validate playlistSize
        if (!config.playlistSize || config.playlistSize <= 0) {
            log.warn({ playlistSize: config.playlistSize, default: defaults.playlistSize }, 'Invalid playlistSize, using default');
            config.playlistSize = defaults.playlistSize;
        }
        
        // Validate port range
        if (!config.rtpPortStart || !config.rtpPortEnd || config.rtpPortStart >= config.rtpPortEnd) {
            log.warn('Invalid port range, using defaults');
            config.rtpPortStart = defaults.rtpPortStart;
            config.rtpPortEnd = defaults.rtpPortEnd;
        }
        
        // Validate videoBitrate
        if (!config.videoBitrate) {
            log.warn({ videoBitrate: config.videoBitrate, default: defaults.videoBitrate }, 'Invalid videoBitrate, using default');
            config.videoBitrate = defaults.videoBitrate;
        }
        
        return config;
    }

export {
    initApp,
    getRouterRtpCapabilites,
    validateHLSConfig
};