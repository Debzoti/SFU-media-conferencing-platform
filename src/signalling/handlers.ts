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
                    
                    console.log(`User joining room: ${data.roomId} with name: ${data.name}`);
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


                //send the room imfoo
                const roomInfo = {
                    roomId: roomIdNumber,
                    users : rooms[roomIdNumber].map(user => ({ id: user.id, name: user.name })),
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
                    
                    //notify users sbout nree producer
                    const roomId = socketToRoom[ws.id];
                    await produce(ws.id, transportId, rtpParameters, kind, roomId.toString());
                    if(roomId && rooms[roomId]){
                        rooms[roomId].forEach(user => {
                            if(user.id !== ws.id){
                                const userSocket   = Array.from(wss.clients).find(
                                    (client) => (client as WebSocket  & {id: string}).id === user.id
                                );
                                if(userSocket && userSocket.readyState === WebSocket.OPEN){
                                    userSocket.send(
                                        JSON.stringify({
                                            type: 'newProducer',
                                            producerId: transportId,
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
                    try{
                        const consumer = await createConsumer( recvTransport, producerId, rtpCapabilities);
                        ws.send(
                            JSON.stringify({
                                type: 'createConsumerResponse',
                                payload: consumer
                            })
                        );
                    }catch(err:any){
                        console.error('Error creating consumer', err);
                        ws.send(
                            JSON.stringify({
                                type: 'createConsumerError',
                                error: err.message
                            })
                        );
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
        cleanupPeer(ws.id);
        const roomId = socketToRoom[ws.id];
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


    export { handleSignallingMessege, handleDisconnect };