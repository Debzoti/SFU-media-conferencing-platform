import { WebSocket, WebSocketServer } from "ws";
import { v4 as uuidv4 } from "uuid";
import { WebSocketWithId } from "../../typings/ws";
import {
        initApp,
        getRouterRtpCapabilites,
        createWebrtcTransport,
        connectTransport,
            produce,
            createConsumer,
            cleanupPeer
    } from "../media/mediaManager";
import { StreamManager } from "src/media/streamManager";
import config from "src/config/config.json";
import { env } from "src/config/binding";

let streamManager : StreamManager;

//handle signalling messages

    const handleSignallingMessege = async (
        ws: WebSocketWithId & {id : string},
        wss: WebSocketServer,
        parsedData: string,
        rooms: { [roomId: string]: { id: string; name: string }[] }, //room name
        socketToRoom:  { [socketId: string]: number } 
        ) => {
        const { type } = JSON.parse(parsedData);
        console.log(type);

        try {
            switch (type) {

                
                case "joinRoom":{
                    //const data = JSON.parse(parsedData);
                    const data = JSON.parse(parsedData);
                    const { roomId, name } = data;
                    
                    console.log(`🚪 User joining room: ${data.roomId} with name: ${data.name}, wsId: ${ws.id}`);
                    if (!data.roomId || !data.name) {
                        ws.send(JSON.stringify({ error: 'Room ID and name are required' }));
                        return;
                    }
                const roomIdNumber = parseInt(roomId, 10);
                
                // Check if the roomId is a valid number
                if (isNaN(roomIdNumber)) {
                    ws.send(JSON.stringify({ error: 'Invalid room ID' }));
                    return;
                }
                
                
                 // check if the room exists, if not create and push the user
                if (!rooms[roomIdNumber] ) {
                    rooms[roomIdNumber] = [{ id: ws.id, name }];
                } else {
                    rooms[roomIdNumber].push({ id: ws.id, name });
                }
                
                socketToRoom[ws.id] = roomIdNumber; //map socket to room
                
                //send back the current users in the room
                const usersInThisRoom = rooms[roomIdNumber].filter(
                    (user) => user.id !== ws.id
                );
                ws.send(
                    JSON.stringify({
                        type: "allUsers",
                        users: usersInThisRoom,
                    })
                );

                //notify users about the avial hlsStreams in this room
                streamManager = new StreamManager(config.hls);
                const hlsstream = streamManager.getSTreamStatus(roomId) ? {
                    playlistUrl : `${env.serverUrl}/hls/${roomId}/playlist.m3u8`
                } : null;

                //send the room imfoo
                const roomInfo = {
                    roomId: roomIdNumber,
                    users : rooms[roomIdNumber].map(user => ({ id: user.id, name: user.name })),
                    hlsstream
                };
                ws.send(JSON.stringify({
                    type: 'roomInfo',
                    roomInfo 
                }));

                    return;
                }

                case "getRouterRtpCapabilities": {
                    const rtpCaps = await getRouterRtpCapabilites();
                    ws.send(
                        JSON.stringify({
                            type: "routerRtpCapabilities",
                            payload: await rtpCaps,
                        })
                    );
                    return;
                }
                
                
                case "createWebrtcTransport": {
                    const wsId = ws.id;
                    const transport = await createWebrtcTransport(wsId);
                    ws.send(
                        JSON.stringify({
                            type: "connectWebrtcTransportResponse",
                            payload: transport,
                        })
                    );
                    return;
                }
                
                case "connectTransport": {
                    const {transportId, dtlsParameters} = JSON.parse(parsedData);
                    await connectTransport(transportId, dtlsParameters);
                    ws.send(
                        JSON.stringify({
                            type: 'connectTransportResponse',
                            payload: { transportId }
                        })
                    );
                    return;
                }


                case "produce": {
                    const {transportId, kind, rtpParameters} = JSON.parse(parsedData);
                    
                    console.log(`📤 Produce request: kind=${kind}, transportId=${transportId}, wsId=${ws.id}`);
                    
                    //notify users about new producer
                    const roomId = socketToRoom[ws.id];
                    const result = await produce(ws.id, transportId, rtpParameters, kind, roomId.toString(), wss, rooms);
                    
                    console.log(`✅ Producer created: ${result.id} for kind=${kind}`);
                    
                    // Send response back to producer
                    ws.send(JSON.stringify({
                        type: 'produceResponse',
                        producerId: result.id,
                        kind: result.kind
                    }));
                    
                    if(roomId && rooms[roomId]){
                        console.log(`🔔 Notifying ${rooms[roomId].length - 1} users about new producer`);
                        rooms[roomId].forEach(user => {
                            if(user.id !== ws.id){
                                const userSocket   = Array.from(wss.clients).find(
                                    (client) => (client as WebSocket  & {id: string}).id === user.id
                                );
                                if(userSocket && userSocket.readyState === WebSocket.OPEN){
                                    console.log(`  📨 Sending newProducer to ${user.id}`);
                                    userSocket.send(
                                        JSON.stringify({
                                            type: 'newProducer',
                                            producerId: result.id,
                                            producerSocketId: ws.id,
                                            kind
                                        })
                                    );
                                }
                            }
                        });
                    }
                    return;
                }

                case "createConsumer" : {
                    const {recvTransport,producerId, rtpCapabilities} = JSON.parse(parsedData);
                    console.log(`📥 Consumer request: producerId=${producerId}, recvTransport=${recvTransport}`);
                    try{
                        const consumer = await createConsumer( recvTransport, producerId, rtpCapabilities);
                        console.log(`✅ Consumer created: ${consumer.id} for producer=${producerId}`);
                        ws.send(
                            JSON.stringify({
                                type: 'createConsumerResponse',
                                payload: consumer
                            })
                        );
                    }catch(err:any){
                        console.error('❌ Error creating consumer:', err);
                        ws.send(
                            JSON.stringify({
                                type: 'createConsumerError',
                                error: err.message
                            })
                        );
                    }
                    return;
                    
                }

                // P2P WebRTC handlers (for simple client)
                case "offer": {
                    const { offer, roomId } = JSON.parse(parsedData);
                    console.log(`📨 Relaying offer in room ${roomId}`);
                    
                    // Forward offer to other users in the room
                    const roomIdNum = parseInt(roomId, 10);
                    if (rooms[roomIdNum]) {
                        rooms[roomIdNum].forEach(user => {
                            if (user.id !== ws.id) {
                                const userSocket = Array.from(wss.clients).find(
                                    (client) => (client as WebSocket & {id: string}).id === user.id
                                );
                                if (userSocket && userSocket.readyState === WebSocket.OPEN) {
                                    userSocket.send(JSON.stringify({ type: 'offer', offer }));
                                }
                            }
                        });
                    }
                    return;
                }

                case "answer": {
                    const { answer, roomId } = JSON.parse(parsedData);
                    console.log(`📨 Relaying answer in room ${roomId}`);
                    
                    // Forward answer to other users in the room
                    const roomIdNum = parseInt(roomId, 10);
                    if (rooms[roomIdNum]) {
                        rooms[roomIdNum].forEach(user => {
                            if (user.id !== ws.id) {
                                const userSocket = Array.from(wss.clients).find(
                                    (client) => (client as WebSocket & {id: string}).id === user.id
                                );
                                if (userSocket && userSocket.readyState === WebSocket.OPEN) {
                                    userSocket.send(JSON.stringify({ type: 'answer', answer }));
                                }
                            }
                        });
                    }
                    return;
                }

                case "iceCandidate": {
                    const { candidate, roomId } = JSON.parse(parsedData);
                    console.log(`🧊 Relaying ICE candidate in room ${roomId}`);
                    
                    // Forward ICE candidate to other users in the room
                    const roomIdNum = parseInt(roomId, 10);
                    if (rooms[roomIdNum]) {
                        rooms[roomIdNum].forEach(user => {
                            if (user.id !== ws.id) {
                                const userSocket = Array.from(wss.clients).find(
                                    (client) => (client as WebSocket & {id: string}).id === user.id
                                );
                                if (userSocket && userSocket.readyState === WebSocket.OPEN) {
                                    userSocket.send(JSON.stringify({ type: 'iceCandidate', candidate }));
                                }
                            }
                        });
                    }
                    return;
                }


            }
            
        } catch (error:any) {
            console.error("Error handling message:", error);
            ws.send(
                JSON.stringify({
                    type:'error',
                    message: error?.message || 'An error occurred'
                })
            )
        }

    }

const handleDisconnect = async (
    ws: WebSocket & {id: string},
    wss: WebSocketServer,
    rooms: { [roomId: string]: { id: string; name: string }[] },
    socketToRoom: { [socketId: string]: number }
) => {
    const roomId = socketToRoom[ws.id];
    await cleanupPeer(ws.id, roomId.toString(), wss, rooms);

        if(roomId && rooms[roomId]){
            rooms[roomId] = rooms[roomId].filter(user => user.id !== ws.id);
            //notify other users
            rooms[roomId].forEach(user => {
                const userSocket  = Array.from(wss.clients).find(
                    (client) => (client as WebSocket  & {id: string}).id === user.id
                );
                if(userSocket && userSocket.readyState === WebSocket.OPEN){
                    userSocket.send(
                        JSON.stringify({
                            type: 'userDisconnected',
                            socketId: ws.id
                        })
                    );
                }
            });
        }
        delete socketToRoom[ws.id]; 
    }

    const broadcastToRoom = async (
        wss :WebSocketServer,
        rooms : { [roomId: string]: { id: string; name: string }[] },
        roomId : string,
        message : object
    ) => {
        //get the clients
        const clients = rooms[roomId];
        if(!clients) return;
        
        const parsedMsg = JSON.stringify(message);

        clients.forEach(client => {
            const clientSocket = Array.from(wss.clients).find(
                (ws: any) => (ws as WebSocket & {id : string}).id === client.id
            );
            if(clientSocket && clientSocket.readyState === WebSocket.OPEN){
                clientSocket.send(parsedMsg);
            }
        })
    }


    export {broadcastToRoom, handleSignallingMessege, handleDisconnect };