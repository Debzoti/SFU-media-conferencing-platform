//signaling server for  peer 2 peer connections
import express , {Request,Response} from 'express';
import http, { Server } from 'http';
import { WebSocketServer } from 'ws';
import { WebSocketWithId, WebSocket } from '../typings/ws'; // Import the extended WebSocket interface
import {v6 as uuidv6} from 'uuid';
import crypto from 'crypto';
import { join } from 'path';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { handleSignallingMessege, handleDisconnect } from './signalling/handlers';
import { initApp } from './media/mediaManager.js';
import { getRouterRtpCapabilites, createWebrtcTransport } from './media/mediaManager';
const app = express();
const server = http.createServer(app);

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve node_modules for ES module imports
app.use('/node_modules', express.static(path.join(__dirname, '..', 'node_modules')));


app.get("/hls/:roomId/playlist.m3u8",(req : Request, res: Response) =>{
  const {roomId} = req.params;
  const playlistPath = path.join(process.cwd(), 'public', 'hls', `room-${roomId}-playlist.m3u8`);

  console.log(`[HLS] Playlist requested for room: ${roomId}`);
  console.log(`[HLS] Looking for file at: ${playlistPath}`);

  if(!fs.existsSync(playlistPath)){
    console.log(`[HLS] Playlist not found: ${playlistPath}`);
    return res.status(404).send('Playlist not found');
  }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(playlistPath);
})

app.get("/hls/:roomId/segment_:segmentId.ts", (req: Request, res: Response) => {
    const { roomId, segmentId } = req.params;
    const segmentPath = path.join(process.cwd(), 'public', 'hls', `room-${roomId}-segment_${segmentId}.ts`);
    
    console.log(`[HLS] Segment requested: room=${roomId}, segment=${segmentId}`);
    console.log(`[HLS] Looking for file at: ${segmentPath}`);
    
    if (!fs.existsSync(segmentPath)) {
        console.log(`[HLS] Segment not found: ${segmentPath}`);
        return res.status(404).send('Segment not found');
    }
    
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(segmentPath);
});

  // Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Test endpoint to manually trigger HLS
app.post('/test-hls/:roomId', async (req, res) => {
    const { roomId } = req.params;
    try {
        console.log(`🧪 Testing HLS for room: ${roomId}`);
        
        // This would normally be triggered by produce() in mediaManager
        // For now, just check if the infrastructure works
        
        res.json({ 
            message: 'HLS test endpoint',
            roomId,
            note: 'HLS requires mediasoup producer to work. Use mediasoup client instead of P2P.'
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

initApp();
 
// //test the rourte 
// app.get('/rtp-capabilities', async (req, res) => {
//   const cap = await getRouterRtpCapabilites();
//   console.log(  'Router RTP Capabilities:', cap);
//   res.json(cap);
// });


// //test transport creation
// app.post('/create-transport', async (req, res) => {
//   // In a real application, you would get the wsId from the authenticated user session
//   const wsId = uuidv6();
//   try {
//     const transport = await createWebrtcTransport(wsId);
//     console.log('Created transport:', transport);
//     res.json(transport);
//   } catch (error : any) {
//     res.status(500).json({ error: error.message });
//   }
// });



//manage new user joining rooms
  //each room have roomId and name
  let rooms: { [roomId: string]: { id: string; name: string }[] } = {}; 
   let socketToRoom: { [socketId: string]: number } = {}; //map to track which socket is in which room

wss.on('connection', (ws: WebSocket) => {
        
        ws.on('message', async (message: Buffer) =>{


          console.log("RAW TYPE:", typeof message);
          console.log("RAW VALUE:", message);
          console.log("AS STRING:", message.toString());

          let parsedData : string;
            try {
              parsedData = message.toString();


              //assig an id to each websocket connection
              if (!(ws as WebSocketWithId).id) {
                //assign a unique ID to the WebSocket connection
                (ws as WebSocketWithId).id = crypto.randomUUID();
                console.log('New client connected', (ws as WebSocketWithId).id);
              } else {
                console.log('Existing client reconnected', (ws as WebSocketWithId).id);
              }


            } catch (error:any | undefined) {
              console.error(error);
              return;
            }
            await handleSignallingMessege(
              ws as WebSocketWithId & {id : string},
              wss,
                parsedData,
                rooms, 
              socketToRoom
            );
        })

        ws.on('close', () =>{
          handleDisconnect(ws as WebSocketWithId & {id : string}, wss, rooms, socketToRoom);
        })
  });






server.listen(3000, () => {
  console.log('Server is listening on port 3000');
});
