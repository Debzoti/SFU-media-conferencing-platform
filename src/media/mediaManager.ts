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
import { HLSTranscoder } from "./hlsTranscoder";
import { broadcastToRoom } from "src/signalling/handlers";
import { WebSocketServer } from "ws";
import { env } from "src/config/binding";
import path from 'path';
import { childLogger } from "src/tools/logger";

const log = childLogger('media');

let configData:Config = config as Config;

// Resolve outputDir to absolute path
const hlsConfig: HLSConfig = {
    ...configData.hls,
    outputDir: path.join(process.cwd(), configData.hls.outputDir)
};

//media manager will handle all the media related tasks
//like creating worker, router, transport, producer, consumer
let worker:mediasoupTypes.Worker<mediasoupTypes.AppData>;
let router:mediasoupTypes.Router<mediasoupTypes.AppData>;
let transport:mediasoupTypes.WebRtcTransport;
let producer:mediasoupTypes.Producer<mediasoupTypes.AppData>;

//manage the producers transports in map for cleanup later
//setup rooms producer, producer ownert in map
const transports:Map<string,mediasoupTypes.WebRtcTransport> = new Map();
const producers:Map<string,mediasoupTypes.Producer<mediasoupTypes.AppData>> = new Map();
const producerOwner:Map<string,string> = new Map(); //map producer id to socket id  
const peerTransports:Map<string,string[]> = new Map(); //map socket id to transport id
const producerRoom : Map<string, Set<string>> = new Map(); // roomId -> Set of producer ids in that room

let streamManager : StreamManager ;

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
    //set up worker which will cretae router and transport

    worker = await createWorker({
        rtcMinPort: configData.rtcMinPort,
        rtcMaxPort: configData.rtcMaxPort,
        logLevel: 'warn',
    })

    worker.on('died', () => {
        log.fatal({ pid: worker.pid }, 'mediasoup worker died, exiting in 2 seconds');
        setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });
        
    //create a router

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
    router  = await worker.createRouter({
        mediaCodecs: mediaCodecs as mediasoupTypes.RtpCodecCapability[],
    })

    //calling stream manager instance
    streamManager = new StreamManager(hlsConfig);

    log.info({ routerId: router.id }, 'Router created');
    
}

//tesing 
async function getRouterRtpCapabilites(){
    if(!router){
        log.error('Router not initialized');

        throw new Error('Router not initialized');
    }
    return router.rtpCapabilities;
}



async function createWebrtcTransport(wsId:string){

    //transport webrtc transport through which we will send media

        transport = await router.createWebRtcTransport({
        listenIps: [
            {ip:'0.0.0.0',announcedIp: undefined},
        ],

        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
    });

    log.info({ transportId: transport.id, wsId }, 'Transport created');

    //record the transports in map fro cleanup later
    transports.set(transport.id, transport);

    const list = peerTransports.get(wsId) ?? [];
    list.push(transport.id);
    peerTransports.set(wsId, list);

    transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
            log.debug({ transportId: transport.id }, 'Transport DTLS state closed, closing transport');
            transport.close();
            transports.delete(transport.id);
        }
    });


    return {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
    };
}

async function connectTransport(
        transportId:string,
        dtlsParameters:mediasoupTypes.DtlsParameters
    ){
    const transport = transports.get(transportId); //get the transportid from map
    if(!transport){
        throw new Error('Transport not found');
    }
    
    await transport.connect({dtlsParameters});
    log.info({ transportId: transport.id }, 'Transport connected');
}

async function produce(
    wsId:string,
    transportId:string,
    rtpParameters:mediasoupTypes.RtpParameters, 
    kind:mediasoupTypes.MediaKind,
    roomId: string,
    wss : WebSocketServer,
    rooms : {[roomId: string] : {id : string, name: string}[]}
){
    const transport = transports.get(transportId); //get the transportid from map
    if(!transport){
        throw new Error('Transport not found');
    }

    const isFirstProducer = !producerRoom.has(roomId) || producerRoom.get(roomId)!.size === 0; //chcek if its first or not 
    //cretae producer for that transport
    const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: {
            wsId,
        }
    });

    
    
    
    //store the producer in map for cleanup later
    producers.set(producer.id, producer);
    producerOwner.set(producer.id, wsId);

    //TODO: handle producerroom 
    if(!producerRoom.has(roomId)){
        producerRoom.set(roomId,new Set());
    }
    producerRoom.get(roomId)?.add(producer.id)
    
    //TODO: start hls if its the first producer
    if(isFirstProducer){
        try {
            await streamManager.startHLSStream(roomId,producer,router);
            log.info({ roomId }, 'started HLS for room');


        } catch (error) {
            log.error({ err: error, roomId }, 'failed to start HLS for room');

        }
        //TODO : brioadcast to all peeers in that room
        const hlsSteamAvailableMsg : HLSStreamAvailableMessege = {
            type : 'hlsSteamAvailable',
            roomId: roomId,
            playlistUrl : `${env.serverUrl}/hls/${roomId}/playlist.m3u8`,
        }

        broadcastToRoom(wss, rooms, roomId, hlsSteamAvailableMsg);
    } 





    producer.on('transportclose', () => {
        log.debug({ producerId: producer.id }, "Producer's transport closed, closing producer");
        producer.close();
        producers.delete(producer.id);
        producerOwner.delete(producer.id);
    });

    log.info({ producerId: producer.id, transportId: transport.id }, 'Producer created');

    return {id: producer.id, kind: producer.kind};
}


//create consumers

async function createConsumer(
    recvTransportId:string, 
    producerId:string, 
    rtpCapabilities:mediasoupTypes.RtpCapabilities
){
    if(!router){
        throw new Error('Router not initialized');
    }

    const recvTransport = transports.get(recvTransportId); //get the transportid from map
    if(!recvTransport){
        throw new Error('Receive Transport not found');
    }

    const consumer = await recvTransport.consume({
        producerId,
        rtpCapabilities,
        paused: false, //we want to start the consumer right away
    });

    // When consumer closed by server or transport close events, the client must handle it too.
    consumer.on('transportclose', () => {
        log.debug('consumer transport closed');
    });
    
    consumer.on('producerclose', () => {
        log.debug('consumer producer closed');
    });

    log.info({ consumerId: consumer.id, transportId: recvTransport.id }, 'Consumer created');

    return {
        id: consumer.id,
        producerId: consumer.producerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
        type: consumer.type,
        producerPaused: consumer.producerPaused,
    };


}

//cleanup all the resources when a peer disconnects
async function cleanupPeer(wsId:string, roomId: string, wss: WebSocketServer,
    rooms : { [roomId: string]: { id: string; name: string }[] },
    ){
    //get all the transport ids for this peer
    const transportIds = peerTransports.get(wsId);
    if(transportIds){
        for(const transportId of transportIds){
            const transport = transports.get(transportId);
            if(transport){
                //close the transport
                transport.close();
                transports.delete(transportId);
                log.info({ transportId }, 'Transport closed');
            }
        }
        peerTransports.delete(wsId);
    }

    //get all the producers owned by this peer
    for(const [producerId, ownerWsId] of producerOwner.entries()){
        if(ownerWsId === wsId){
            const producer = producers.get(producerId);
            if(producer){
                //close the producer
                producer.close();
                producers.delete(producerId);
                producerOwner.delete(producerId);
                producerRoom.get(roomId)?.delete(producerId);
                log.info({ producerId }, 'Producer closed');
            }
        }
    }

    
    if(producerRoom.get(roomId)?.size === 0){
        log.info({ roomId }, 'last producer leaving, stopping HLS');
        
        await streamManager.stopHLSStream(roomId);
        producerRoom.delete(roomId);

        const hlsUnAvailMsg : HLSUnavailable = {
            type: 'hlsUnavailable',
            roomId : roomId
        }
        broadcastToRoom(wss,rooms,roomId, hlsUnAvailMsg);
    }
    log.info({ wsId }, 'Cleanup completed for peer');

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
    createWebrtcTransport,
    connectTransport,
    produce,
    createConsumer,
    cleanupPeer,
    validateHLSConfig
};