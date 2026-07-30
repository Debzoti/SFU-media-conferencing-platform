//signaling server for  peer 2 peer connections
import express , {Request,Response} from 'express';
import http, { Server } from 'http';
import { WebSocketServer } from 'ws';
import { WebSocketWithId, WebSocket } from './typings/ws'; // Import the extended WebSocket interface
import {v6 as uuidv6} from 'uuid';
import crypto from 'crypto';
import { join } from 'path';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { handleSignallingMessege, handleDisconnect } from './signalling/handlers';
import { initApp } from './media/mediaManager.js';
import { getRouterRtpCapabilites, createWebrtcTransport } from './media/mediaManager';
import { childLogger } from './tools/logger';
import { env } from './config/binding';
import { TransportManager } from './media/transportManager';

// Listen port comes from the PORT env var (set in docker-compose), falling back
// to 3000 for local dev. Must match the published port in docker-compose.yml.
const PORT = Number(env.port) || 3000;
const log = childLogger('server');
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

  log.debug({ roomId, playlistPath }, 'HLS playlist requested');

  if(!fs.existsSync(playlistPath)){
    log.warn({ roomId, playlistPath }, 'HLS playlist not found');
    return res.status(404).send('Playlist not found');
  }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(playlistPath);
})

// FFmpeg writes segments flat as room-<id>-segment_NNN.ts next to the playlist,
// so the playlist references that full basename and the browser requests
// /hls/<roomId>/room-<roomId>-segment_NNN.ts. roomId2 is the duplicated id from
// that basename and is intentionally unused.
app.get("/hls/:roomId/room-:roomId2-segment_:segmentId.ts", (req: Request, res: Response) => {
    const { roomId, segmentId } = req.params;
    const segmentPath = path.join(process.cwd(), 'public', 'hls', `room-${roomId}-segment_${segmentId}.ts`);
    
    log.debug({ roomId, segmentId, segmentPath }, 'HLS segment requested');

    if (!fs.existsSync(segmentPath)) {
        log.warn({ roomId, segmentId, segmentPath }, 'HLS segment not found');
        return res.status(404).send('Segment not found');
    }
    
    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.sendFile(segmentPath);
});


/*------------------------------------------- */

  // Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Test endpoint to manually trigger HLS
app.post('/test-hls/:roomId', async (req, res) => {
    const { roomId } = req.params;
    try {
        log.info({ roomId }, 'Testing HLS for room');
        
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




//manage new user joining rooms
  //each room have roomId and name
  let rooms: { [roomId: string]: { id: string; name: string }[] } = {}; 
   let socketToRoom: { [socketId: string]: number } = {}; //map to track which socket is in which room
  const { transportManager, streamManager } = await initApp();

wss.on('connection', (ws: WebSocket) => {
        
        ws.on('message', async (message: Buffer) =>{


          log.debug({ rawType: typeof message }, 'raw message received');

          let parsedData : string;
            try {
              parsedData = message.toString();

              //assig an id to each websocket connection
              if (!(ws as WebSocketWithId).id) {
                //assign a unique ID to the WebSocket connection
                (ws as WebSocketWithId).id = crypto.randomUUID();
                // Bind a per-connection child logger so every line for this peer
                // is tagged with peerId (roomId gets added once they join a room).
                (ws as WebSocketWithId).log = childLogger('signalling', { peerId: (ws as WebSocketWithId).id });
                (ws as WebSocketWithId).log!.info('new client connected');
              } else {
                (ws as WebSocketWithId).log?.info('existing client reconnected');
              }


            } catch (error:any | undefined) {
              ((ws as WebSocketWithId).log ?? log).error({ err: error }, 'failed to parse incoming message');
              return;
            }
            await handleSignallingMessege(
              ws as WebSocketWithId & {id : string},
              wss,
                parsedData,
                rooms, 
              socketToRoom,
              transportManager
            );
        })

        ws.on('close', () =>{
          handleDisconnect(ws as WebSocketWithId & {id : string}, wss, rooms, socketToRoom);
        })
  });






server.listen(PORT, () => {
  log.info({ port: PORT }, 'Server is listening');
});
