

const localVideo = document.getElementById("localVideo");
const button = document.getElementById("joinBtn");
const remoteVideo = document.getElementById("remoteVideo")


//store variable of stream to send to the server
let localStream ={
    localStream: null,
};
let peerConnection;
let remoteStream ;
let ws;
let pendingCandidates = [];
let currentRoomId = null;

const iceServers = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302" // Google's public STUN server
        },
        // {
        //     urls: "turn:your.turn.server:3478", // Replace with your TURN server
        //     username: "your_ume
        //     credential: "your_credential" // Replace with yoursername", // Replace with your TURN server userna TURN server credential
        // }
    ]
};

//connect to the server by clicking button and send the roomId and name
button.addEventListener("click", async () => {
    
  
    const roomId = document.getElementById("roomInput").value;
    const name = prompt("Enter your name:");
    if (!roomId || !name) {
        alert("Please enter a room ID and your name."); 
        return;
    }
    
    currentRoomId = roomId;

    button.disabled = true; // Disable the button after clicking
    button.textContent = "Joining...";
    
    
    //connect video stream to the server
   await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then((stream) => {
        localStream.localStream = stream;
        localVideo.srcObject = stream;
        localVideo.play();
    })
    .catch((error) => {
        console.error("Error accessing media devices.", error);
    });

    //first connect your local stream to the server
    
    ws = new WebSocket("ws://localhost:3000");
    
    ws.onopen = () => {
        console.log("WebSocket connection established");
        button.disabled = false; // Enable the button once connected
        button.textContent = "Join Room";
        ws.send(JSON.stringify({ type: "joinRoom", roomId, name }));
            
        };
        ws.onmessage = async (event) => {
            const data = JSON.parse(event.data);

            switch (data.type) {
                case "room_users":{
                    console.log("Room users:", data.users);
                    
                    if (!peerConnection) {
                        await setUpPeerConnection();
                    }
                    
                    // Here you can handle the list of users in the room
                    const otherUsers = data.users.filter(u => u.id !== ws.id);
                    console.log("Other users in the room:", otherUsers);
                    if (otherUsers.length > 0) {
                        console.log("Creating offer to other users");
                        await createAndSendoffer();
                    }
                    break;
                }
                case "offer":{
                    await handleOffer(data.offer);
                    break;
                }
                case "roomInfo":{
                    break;
                }
                case "answer":{
                    await handleAnswer(data.answer);
                    break;
                }
                case "iceCandidate":{
                    handleIceCandidate(data.candidate);
                    break;
                }
                default:
                    break;
            }
        
        
        
        }
        ws.onerror = (error) => {
            console.error("WebSocket error:", error);
        }
        ws.onclose = () => {
            console.log("WebSocket connection closed");
            alert("Disconnected from the room.");
        
            if (peerConnection) {
                peerConnection.close();
                peerConnection = null;
            }
        
            if (localStream?.localStream) {
                localStream.localStream.getTracks().forEach(track => track.stop());
                localStream.localStream = null;
            }
        
            if (remoteVideo.srcObject) {
                remoteVideo.srcObject.getTracks().forEach(track => track.stop());
                remoteVideo.srcObject = null;
            }
        
            button.disabled = false;
            button.textContent = "Join Room";
            document.getElementById("roomInput").value = "";
        };
        
        
})


async function setUpPeerConnection(){
     peerConnection = new RTCPeerConnection(iceServers);
     remoteStream = new MediaStream();
     
     
     //add local streams
    localStream.localStream.getTracks().forEach(track => {
        peerConnection.addTrack(track, localStream.localStream);
    });
    
    // remote stream handling
   peerConnection.ontrack = (event) =>{
    console.log("Remote track received:", event.streams);
    if (!remoteVideo.srcObject) {
        remoteVideo.srcObject = event.streams[0];
    }
   }
    
    //handle ice candidates
    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            ws.send(JSON.stringify({
                    type: "iceCandidate",
                    candidate: event.candidate,
                    roomId: currentRoomId
                }));
            }
        }
    
        peerConnection.onconnectionstatechange = () => {
            console.log("🔹 PeerConnection state:", peerConnection.connectionState);
        };
        
        peerConnection.oniceconnectionstatechange = () => {
            console.log("🔹 ICE connection state:", peerConnection.iceConnectionState);
        };
        
        peerConnection.onicegatheringstatechange = () => {
            console.log("🔹 ICE gathering state:", peerConnection.iceGatheringState);
        };        
        
}

async function createAndSendoffer() {
    try {
        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer); //set local description
        ws.send(JSON.stringify({type:"offer",offer,roomId:currentRoomId}));
        
    } catch (error) {
        console.error("creating and sebding error", error);
        
    }
}

async function handleOffer(offer){
    try {

        if (!peerConnection) {
            await setUpPeerConnection();

        }
       
    
        //set remote description according to the offer
        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));


        // Add buffered ICE candidates after remote description is set
        for (const candidate of pendingCandidates) {
            await peerConnection.addIceCandidate(candidate);
        }
        pendingCandidates = [];



        const answer = await peerConnection.createAnswer(); //create answer to that offer
        await peerConnection.setLocalDescription(answer); // chnages the local mode acc to answer sdp
        ws.send(JSON.stringify(
            {
                type: "answer",
                answer,
                roomId:currentRoomId
            }
        ))
        
    } catch (error) {
        console.error("err handeling offer",error);
        
    }
}

async function handleAnswer(answer){
    try {
        
        await peerConnection.setRemoteDescription(new RTCSessionDescription(answer)); //set remote after getting answer

         // Add buffered ICE candidates
         for (const candidate of pendingCandidates) {
            await peerConnection.addIceCandidate(candidate);
        }
        pendingCandidates = [];
    } catch (error) {
        console.error(error);
        
    }
}

async function handleIceCandidate(iceCandidate) {
    if (peerConnection.remoteDescription && peerConnection.remoteDescription.type) {
        await peerConnection.addIceCandidate(iceCandidate);
    } else {
        pendingCandidates.push(iceCandidate);
    }
}