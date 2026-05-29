// import mediasoup ,
// {
//     Worker,
//     Router,
//     Producer,Consumer,RtpParameters,
//     WebRtcTransport,
// }from 'mediasoup/node/lib/types';

import { types as mediasoupTypes,createWorker } from "mediasoup";

import config from '../../config.json' ;
import {Config} from '../config' ;
import { StreamManager } from "./streamManager";
import { HLSTranscoder } from "./hlsTranscoder";

let configData:Config = config as Config;

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
        console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
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
    streamManager = new StreamManager(config.hls);

    console.log('Router created with id:', router.id);
    
}

//tesing 
async function getRouterRtpCapabilites(){
    if(!router){
        console.log('Router not initialized');
        
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

    console.log(`Transport created: ${transport.id}`);

    //record the transports in map fro cleanup later
    transports.set(transport.id, transport);

    const list = peerTransports.get(wsId) ?? [];
    list.push(transport.id);
    peerTransports.set(wsId, list);

    transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
            console.log('Transport DTLS state closed, closing transport');
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
    console.log(`Transport connected: ${transport.id}`);
}

async function produce(
    wsId:string,
    transportId:string,
    rtpParameters:mediasoupTypes.RtpParameters, 
    kind:mediasoupTypes.MediaKind,
    roomId: string
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
            console.log(`started HLS for room - ${roomId}`);
            
        } catch (error) {
            console.log(`failed to start Hls for room - ${roomId}`);
            
        }
    } 





    producer.on('transportclose', () => {
        console.log(`Producer's transport closed, closing producer ${producer.id}`);
        producer.close();
        producers.delete(producer.id);
        producerOwner.delete(producer.id);
    });

    console.log(`Producer created: ${producer.id} for transport: ${transport.id}`);

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
        console.log('consumer transport closed');
    });
    
    consumer.on('producerclose', () => {
        console.log('consumer producer closed');
    });

    console.log(`Consumer created: ${consumer.id} for transport: ${recvTransport.id}`);

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
async function cleanupPeer(wsId:string, roomId: string){
    //get all the transport ids for this peer
    const transportIds = peerTransports.get(wsId);
    if(transportIds){
        for(const transportId of transportIds){
            const transport = transports.get(transportId);
            if(transport){
                //close the transport
                transport.close();
                transports.delete(transportId);
                console.log(`Transport closed: ${transportId}`);
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
                console.log(`Producer closed: ${producerId}`);
            }
        }
    }

    
    if(producerRoom.get(roomId)?.size === 0){
        console.log(`last producer leaving ${roomId} , stoopping hls `);
        
        await streamManager.stopHLSStream(roomId);
        producerRoom.delete(roomId);
    }
    console.log(`Cleanup completed for peer: ${wsId}`);

}

export {
    initApp,
    getRouterRtpCapabilites,
    createWebrtcTransport,
    connectTransport,
    produce,
    createConsumer,
    cleanupPeer,
};