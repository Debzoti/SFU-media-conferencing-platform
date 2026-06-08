// Mediasoup client implementation for WebRTC streaming
import * as mediasoupClient from 'mediasoup-client';

const localVideo = document.getElementById("localVideo");
const button = document.getElementById("joinBtn");
const remoteVideo = document.getElementById("remoteVideo");

// Store variables
let localStream = null;
let device = null;
let sendTransport = null;
let recvTransport = null;
let ws = null;
let currentRoomId = null;
let videoProducer = null;
let audioProducer = null;
let consumers = new Map();

button.addEventListener("click", async () => {
    const roomId = document.getElementById("roomInput").value;
    const name = prompt("Enter your name:");
    if (!roomId || !name) {
        alert("Please enter a room ID and your name.");
        return;
    }

    currentRoomId = roomId;
    button.disabled = true;
    button.textContent = "Joining...";

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        localVideo.srcObject = localStream;
        await localVideo.play();

        ws = new WebSocket("ws://localhost:3000");

        ws.onopen = async () => {
            console.log("✅ WebSocket connection established");
            button.textContent = "Connected";
            ws.send(JSON.stringify({ type: "joinRoom", roomId, name }));
        };

        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            console.log("📩 Message received:", data.type);

            try {
                await handleMessage(data);
            } catch (error) {
                console.error("❌ Error handling message:", error);
            }
        };

        ws.onerror = (error) => {
            console.error("❌ WebSocket error:", error);
        };

        ws.onclose = () => {
            console.log("🔌 WebSocket connection closed");
            cleanup();
        };

    } catch (error) {
        console.error("❌ Error accessing media devices:", error);
        button.disabled = false;
        button.textContent = "Join Room";
    }
});

async function handleMessage(data) {
    switch (data.type) {
        case "roomInfo":
            console.log("🏠 Room info received:", data.roomInfo);
            await initializeMediasoup();
            break;

        case "routerRtpCapabilities":
            console.log("📡 Router RTP capabilities received");
            await loadDevice(data.payload);
            break;

        case "connectWebrtcTransportResponse":
            console.log("🔗 Transport created:", data.payload.id);
            await handleTransportCreated(data.payload);
            break;

        case "connectTransportResponse":
            console.log("✅ Transport connected:", data.payload.transportId);
            break;

        case "newProducer":
            console.log("🎥 New producer available:", data);
            await handleNewProducer(data);
            break;

        case "createConsumerResponse":
            console.log("📺 Consumer created:", data.payload);
            await handleConsumerCreated(data.payload);
            break;

        case "createConsumerError":
            console.error("❌ Error creating consumer:", data.error);
            break;

        case "hlsStreamAvailable":
            console.log("✅ HLS stream is now available!");
            console.log("📺 Watch at:", data.playlistUrl);
            showHLSNotification(data.playlistUrl);
            break;

        case "hlsStreamUnavailable":
            console.log("❌ HLS stream stopped");
            hideHLSNotification();
            break;

        case "userDisconnected":
            console.log("👋 User disconnected:", data.socketId);
            break;

        case "error":
            console.error("❌ Server error:", data.message);
            break;

        default:
            console.log("⚠️ Unknown message type:", data.type);
            break;
    }
}

async function initializeMediasoup() {
    console.log("🚀 Initializing mediasoup...");
    ws.send(JSON.stringify({ type: "getRouterRtpCapabilities" }));
}

async function loadDevice(routerRtpCapabilities) {
    try {
        device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities });
        
        console.log("✅ Device loaded with RTP capabilities");
        console.log("📱 Can produce video:", device.canProduce("video"));
        console.log("📱 Can produce audio:", device.canProduce("audio"));

        await createSendTransport();
        await createRecvTransport();

    } catch (error) {
        console.error("❌ Error loading device:", error);
    }
}

async function createSendTransport() {
    console.log("📤 Creating send transport...");
    ws.send(JSON.stringify({ type: "createWebrtcTransport" }));
}

async function createRecvTransport() {
    console.log("📥 Creating receive transport...");
    ws.send(JSON.stringify({ type: "createWebrtcTransport" }));
}

async function handleTransportCreated(transportInfo) {
    const { id, iceParameters, iceCandidates, dtlsParameters } = transportInfo;

    if (!sendTransport) {
        sendTransport = device.createSendTransport({
            id,
            iceParameters,
            iceCandidates,
            dtlsParameters
        });

        sendTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                console.log("🔗 Send transport connecting...");
                ws.send(JSON.stringify({
                    type: "connectTransport",
                    transportId: sendTransport.id,
                    dtlsParameters
                }));
                
                const confirmHandler = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === "connectTransportResponse" && data.payload.transportId === sendTransport.id) {
                        ws.removeEventListener('message', confirmHandler);
                        callback();
                    }
                };
                ws.addEventListener('message', confirmHandler);
            } catch (error) {
                errback(error);
            }
        });

        sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
            try {
                console.log(`🎬 Producing ${kind}...`);
                ws.send(JSON.stringify({
                    type: "produce",
                    transportId: sendTransport.id,
                    kind,
                    rtpParameters
                }));

                callback({ id: sendTransport.id });
            } catch (error) {
                errback(error);
            }
        });

        sendTransport.on('connectionstatechange', (state) => {
            console.log(`📤 Send transport state: ${state}`);
        });

        await produceMedia();

    } else if (!recvTransport) {
        recvTransport = device.createRecvTransport({
            id,
            iceParameters,
            iceCandidates,
            dtlsParameters
        });

        recvTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
            try {
                console.log("🔗 Receive transport connecting...");
                ws.send(JSON.stringify({
                    type: "connectTransport",
                    transportId: recvTransport.id,
                    dtlsParameters
                }));
                
                const confirmHandler = (event) => {
                    const data = JSON.parse(event.data);
                    if (data.type === "connectTransportResponse" && data.payload.transportId === recvTransport.id) {
                        ws.removeEventListener('message', confirmHandler);
                        callback();
                    }
                };
                ws.addEventListener('message', confirmHandler);
            } catch (error) {
                errback(error);
            }
        });

        recvTransport.on('connectionstatechange', (state) => {
            console.log(`📥 Receive transport state: ${state}`);
        });

        console.log("✅ Receive transport created");
    }
}

async function produceMedia() {
    if (!localStream || !sendTransport) {
        console.error("❌ Cannot produce: missing stream or transport");
        return;
    }

    try {
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack && device.canProduce('video')) {
            videoProducer = await sendTransport.produce({ track: videoTrack });
            console.log("✅ Video producer created:", videoProducer.id);
        }

        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack && device.canProduce('audio')) {
            audioProducer = await sendTransport.produce({ track: audioTrack });
            console.log("✅ Audio producer created:", audioProducer.id);
        }

    } catch (error) {
        console.error("❌ Error producing media:", error);
    }
}

async function handleNewProducer(data) {
    const { producerId, producerSocketId, kind } = data;
    
    console.log(`🆕 New ${kind} producer from ${producerSocketId}:`, producerId);

    if (!recvTransport) {
        console.error("❌ Cannot consume: receive transport not ready");
        return;
    }

    ws.send(JSON.stringify({
        type: "createConsumer",
        recvTransport: recvTransport.id,
        producerId: producerId,
        rtpCapabilities: device.rtpCapabilities
    }));
}

async function handleConsumerCreated(consumerInfo) {
    const { id, producerId, kind, rtpParameters } = consumerInfo;

    try {
        const consumer = await recvTransport.consume({
            id,
            producerId,
            kind,
            rtpParameters
        });

        consumers.set(consumer.id, consumer);

        const { track } = consumer;
        
        if (!remoteVideo.srcObject) {
            remoteVideo.srcObject = new MediaStream();
        }

        remoteVideo.srcObject.addTrack(track);
        await remoteVideo.play();

        console.log(`✅ ${kind} consumer created and track added:`, consumer.id);

    } catch (error) {
        console.error("❌ Error consuming:", error);
    }
}

function cleanup() {
    console.log("🧹 Cleaning up...");

    if (videoProducer) {
        videoProducer.close();
        videoProducer = null;
    }
    if (audioProducer) {
        audioProducer.close();
        audioProducer = null;
    }

    consumers.forEach(consumer => consumer.close());
    consumers.clear();

    if (sendTransport) {
        sendTransport.close();
        sendTransport = null;
    }
    if (recvTransport) {
        recvTransport.close();
        recvTransport = null;
    }

    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (localVideo.srcObject) {
        localVideo.srcObject = null;
    }
    if (remoteVideo.srcObject) {
        remoteVideo.srcObject = null;
    }

    button.disabled = false;
    button.textContent = "Join Room";
    document.getElementById("roomInput").value = "";
}

function showHLSNotification(playlistUrl) {
    hideHLSNotification();

    const notification = document.createElement('div');
    notification.id = 'hls-notification';
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 15px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 1000;
        max-width: 300px;
        font-family: Arial, sans-serif;
    `;

    notification.innerHTML = `
        <strong>🎥 HLS Stream Ready!</strong><br/>
        <small>Room: ${currentRoomId}</small><br/>
        <a href="/watch.html?room=${currentRoomId}" target="_blank" 
           style="color: white; text-decoration: underline; margin-top: 8px; display: inline-block;">
            Open HLS Player →
        </a>
    `;

    document.body.appendChild(notification);
}

function hideHLSNotification() {
    const existing = document.getElementById('hls-notification');
    if (existing) {
        existing.remove();
    }
}
