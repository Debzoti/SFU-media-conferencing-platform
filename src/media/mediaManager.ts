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

async function initApp() {

  //use the workerManager instance and pull router
  workerManager = new WorkerManager(config)
  await workerManager.init();

  //calling the transport manager instance
  const transportManager = new TransportManager(workerManager);
  
  //calling stream manager instance
  streamManager = new StreamManager(hlsConfig);
  
  //calling the producer manager instance
  const producerManager = new ProducerManager(transportManager, workerManager, streamManager);

  //calling the consumer manager instance
  const consumerManager = new ConsumerManager(workerManager, transportManager);
  

  return { transportManager, streamManager, producerManager, workerManager, consumerManager };
    
}

//tesing 
async function getRouterRtpCapabilites(){
    if(!workerManager.getRouter()){
        log.error('Router not initialized');

        throw new Error('Router not initialized');
    }
    return workerManager.getRouter().rtpCapabilities;
}











// //cleanup all the resources when a peer disconnects
// async function cleanupPeer(wsId:string, roomId: string, wss: WebSocketServer,
//     rooms : { [roomId: string]: { id: string; name: string }[] },
//     ){
//     //get all the transport ids for this peer
//     const transportIds = peerTransports.get(wsId);
//     if(transportIds){
//         for(const transportId of transportIds){
//             const transport = transports.get(transportId);
//             if(transport){
//                 //close the transport
//                 transport.close();
//                 transports.delete(transportId);
//                 log.info({ transportId, peerId: wsId }, 'Transport closed');
//             }
//         }
//         peerTransports.delete(wsId);
//     }

//     //get all the producers owned by this peer
//     for(const [producerId, ownerWsId] of producerOwner.entries()){
//         if(ownerWsId === wsId){
//             const producer = producers.get(producerId);
//             if(producer){
//                 //close the producer
//                 producer.close();
//                 producers.delete(producerId);
//                 producerOwner.delete(producerId);
//                 producerRoom.get(roomId)?.delete(producerId);
//                 log.info({ producerId, peerId: wsId, roomId }, 'Producer closed');
//             }
//         }
//     }

    
//     if(producerRoom.get(roomId)?.size === 0){
//         log.info({ roomId }, 'last producer leaving, stopping HLS');
        
//         await streamManager.stopHLSStream(roomId);
//         producerRoom.delete(roomId);

//         const hlsUnAvailMsg : HLSUnavailable = {
//             type: 'hlsUnavailable',
//             roomId : roomId
//         }
//         broadcastToRoom(wss,rooms,roomId, hlsUnAvailMsg);
//     }
//     log.info({ peerId: wsId, roomId }, 'Cleanup completed for peer');

// }

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