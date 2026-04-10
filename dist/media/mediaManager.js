// import mediasoup ,
// {
//     Worker,
//     Router,
//     Producer,Consumer,RtpParameters,
//     WebRtcTransport,
// }from 'mediasoup/node/lib/types';
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { createWorker } from "mediasoup";
import config from '../../config.json';
let configData = config;
//media manager will handle all the media related tasks
//like creating worker, router, transport, producer, consumer
let worker;
let router;
let transport;
let producer;
//manage the producers transports in map for cleanup later
//setup rooms producer, producer ownert in map
const transports = new Map();
const producers = new Map();
const producerOwner = new Map(); //map producer id to socket id  
const peerTransports = new Map(); //map socket id to transport id
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
function initApp() {
    return __awaiter(this, void 0, void 0, function* () {
        //set up worker which will cretae router and transport
        worker = yield createWorker({
            rtcMinPort: configData.rtcMinPort,
            rtcMaxPort: configData.rtcMaxPort,
            logLevel: 'warn',
        });
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
                channels: 2,
                preferredPayloadType: 100,
                parameters: {
                    "x-google-start-bitrate": 1000,
                },
                rtcpFeedback: [
                    { type: "nack" },
                    { type: "ccm", parameter: "fir" },
                    { type: "goog-remb" }
                ],
            }, {
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
        ];
        router = yield worker.createRouter({
            mediaCodecs: mediaCodecs,
        });
        console.log('Router created with id:', router.id);
    });
}
//tesing 
function getRouterRtpCapabilites() {
    return __awaiter(this, void 0, void 0, function* () {
        if (!router) {
            console.log('Router not initialized');
            throw new Error('Router not initialized');
        }
        return router.rtpCapabilities;
    });
}
function createWebrtcTransport(wsId) {
    return __awaiter(this, void 0, void 0, function* () {
        //transport webrtc transport through which we will send media
        var _a;
        transport = yield router.createWebRtcTransport({
            listenIps: [
                { ip: '0.0.0.0', announcedIp: undefined },
            ],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate: 1000000,
        });
        console.log(`Transport created: ${transport.id}`);
        //record the transports in map fro cleanup later
        transports.set(transport.id, transport);
        const list = (_a = peerTransports.get(wsId)) !== null && _a !== void 0 ? _a : [];
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
    });
}
function connectTransport(transportId, dtlsParameters) {
    return __awaiter(this, void 0, void 0, function* () {
        const transport = transports.get(transportId); //get the transportid from map
        if (!transport) {
            throw new Error('Transport not found');
        }
        yield transport.connect({ dtlsParameters });
        console.log(`Transport connected: ${transport.id}`);
    });
}
function produce(wsId, transportId, rtpParameters, kind) {
    return __awaiter(this, void 0, void 0, function* () {
        const transport = transports.get(transportId); //get the transportid from map
        if (!transport) {
            throw new Error('Transport not found');
        }
        //cretae producer for that transport
        const producer = yield transport.produce({
            kind,
            rtpParameters,
            appData: {
                wsId,
            }
        });
        //store the producer in map for cleanup later
        producers.set(producer.id, producer);
        producerOwner.set(producer.id, wsId);
        producer.on('transportclose', () => {
            console.log(`Producer's transport closed, closing producer ${producer.id}`);
            producer.close();
            producers.delete(producer.id);
            producerOwner.delete(producer.id);
        });
        console.log(`Producer created: ${producer.id} for transport: ${transport.id}`);
        return { id: producer.id, kind: producer.kind };
    });
}
//create consumers
function createConsumer(recvTransportId, producerId, rtpCapabilities) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!router) {
            throw new Error('Router not initialized');
        }
        const recvTransport = transports.get(recvTransportId); //get the transportid from map
        if (!recvTransport) {
            throw new Error('Receive Transport not found');
        }
        const consumer = yield recvTransport.consume({
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
    });
}
//cleanup all the resources when a peer disconnects
function cleanupPeer(wsId) {
    return __awaiter(this, void 0, void 0, function* () {
        //get all the transport ids for this peer
        const transportIds = peerTransports.get(wsId);
        if (transportIds) {
            for (const transportId of transportIds) {
                const transport = transports.get(transportId);
                if (transport) {
                    //close the transport
                    transport.close();
                    transports.delete(transportId);
                    console.log(`Transport closed: ${transportId}`);
                }
            }
            peerTransports.delete(wsId);
        }
        //get all the producers owned by this peer
        for (const [producerId, ownerWsId] of producerOwner.entries()) {
            if (ownerWsId === wsId) {
                const producer = producers.get(producerId);
                if (producer) {
                    //close the producer
                    producer.close();
                    producers.delete(producerId);
                    producerOwner.delete(producerId);
                    console.log(`Producer closed: ${producerId}`);
                }
            }
        }
        console.log(`Cleanup completed for peer: ${wsId}`);
    });
}
export { initApp, getRouterRtpCapabilites, createWebrtcTransport, connectTransport, produce, createConsumer, cleanupPeer, };
