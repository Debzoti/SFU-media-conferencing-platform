var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { WebSocket } from "ws";
import { getRouterRtpCapabilites, createWebrtcTransport, connectTransport, produce, createConsumer, cleanupPeer } from "../media/mediaManager";
//handle signalling messages
const handleSignallingMessege = (ws, wss, parsedData, rooms, //room name
socketToRoom) => __awaiter(void 0, void 0, void 0, function* () {
    const { type } = JSON.parse(parsedData);
    console.log(type);
    try {
        switch (type) {
            case "joinRoom": {
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
                if (!rooms[roomIdNumber]) {
                    rooms[roomIdNumber] = [{ id: ws.id, name }];
                }
                else {
                    rooms[roomIdNumber].push({ id: ws.id, name });
                }
                socketToRoom[ws.id] = roomIdNumber; //map socket to room
                //send back the current users in the room
                const usersInThisRoom = rooms[roomIdNumber].filter((user) => user.id !== ws.id);
                ws.send(JSON.stringify({
                    type: "allUsers",
                    users: usersInThisRoom,
                }));
                //send the room imfoo
                const roomInfo = {
                    roomId: roomIdNumber,
                    users: rooms[roomIdNumber].map(user => ({ id: user.id, name: user.name })),
                };
                ws.send(JSON.stringify({
                    type: 'roomInfo',
                    roomInfo
                }));
                return;
            }
            case "getRouterRtpCapabilities": {
                const rtpCaps = yield getRouterRtpCapabilites();
                ws.send(JSON.stringify({
                    type: "routerRtpCapabilities",
                    payload: yield rtpCaps,
                }));
                return;
            }
            case "createWebrtcTransport": {
                const wsId = ws.id;
                const transport = yield createWebrtcTransport(wsId);
                ws.send(JSON.stringify({
                    type: "connectWebrtcTransportResponse",
                    payload: transport,
                }));
                return;
            }
            case "connectTransport": {
                const { transportId, dtlsParameters } = JSON.parse(parsedData);
                yield connectTransport(transportId, dtlsParameters);
                ws.send(JSON.stringify({
                    type: 'connectTransportResponse',
                    payload: { transportId }
                }));
                return;
            }
            case "produce": {
                const { transportId, kind, rtpParameters } = JSON.parse(parsedData);
                yield produce(ws.id, transportId, rtpParameters, kind);
                //notify users sbout nree producer
                const roomId = socketToRoom[ws.id];
                if (roomId && rooms[roomId]) {
                    rooms[roomId].forEach(user => {
                        if (user.id !== ws.id) {
                            const userSocket = Array.from(wss.clients).find((client) => client.id === user.id);
                            if (userSocket && userSocket.readyState === WebSocket.OPEN) {
                                userSocket.send(JSON.stringify({
                                    type: 'newProducer',
                                    producerId: transportId,
                                    producerSocketId: ws.id,
                                    kind
                                }));
                            }
                        }
                    });
                }
                return;
            }
            case "createConsumer": {
                const { recvTransport, producerId, rtpCapabilities } = JSON.parse(parsedData);
                try {
                    const consumer = yield createConsumer(recvTransport, producerId, rtpCapabilities);
                    ws.send(JSON.stringify({
                        type: 'createConsumerResponse',
                        payload: consumer
                    }));
                }
                catch (err) {
                    console.error('Error creating consumer', err);
                    ws.send(JSON.stringify({
                        type: 'createConsumerError',
                        error: err.message
                    }));
                }
                return;
            }
        }
    }
    catch (error) {
        console.error("Error handling message:", error);
        ws.send(JSON.stringify({
            type: 'error',
            message: (error === null || error === void 0 ? void 0 : error.message) || 'An error occurred'
        }));
    }
});
const handleDisconnect = (ws, wss, rooms, socketToRoom) => __awaiter(void 0, void 0, void 0, function* () {
    cleanupPeer(ws.id);
    const roomId = socketToRoom[ws.id];
    if (roomId && rooms[roomId]) {
        rooms[roomId] = rooms[roomId].filter(user => user.id !== ws.id);
        //notify other users
        rooms[roomId].forEach(user => {
            const userSocket = Array.from(wss.clients).find((client) => client.id === user.id);
            if (userSocket && userSocket.readyState === WebSocket.OPEN) {
                userSocket.send(JSON.stringify({
                    type: 'userDisconnected',
                    socketId: ws.id
                }));
            }
        });
    }
    delete socketToRoom[ws.id];
});
export { handleSignallingMessege, handleDisconnect };
