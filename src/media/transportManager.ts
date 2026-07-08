import { WebRtcTransportResponse } from "src/config/config";
import { types as mediasoupTypes } from "mediasoup";
import { WorkerManager } from "./workerManager";
import { logger, childLogger } from "src/tools/logger";


const log = childLogger('media');

export class TransportManager{
  private transportsMap!: Map<string, mediasoupTypes.WebRtcTransport>;
  private peerTransportsMap!: Map<string, string[]>;
  private workerManager!: WorkerManager;
  
  constructor(router: WorkerManager) {
    this.transportsMap = new Map();
    this.peerTransportsMap = new Map();
    this.workerManager = router;
  }

  async createWebrtcTransport(wsId: string): Promise<WebRtcTransportResponse>{
    //transport webrtc transport through which we will send media

        const transport = await this.workerManager.getRouter().createWebRtcTransport({
        listenIps: [
            {ip:'0.0.0.0',announcedIp: undefined},
        ],

        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
        initialAvailableOutgoingBitrate: 1000000,
    });

    log.info({ transportId: transport.id, peerId: wsId }, 'Transport created');

    //record the transports in map fro cleanup later
    this.transportsMap.set( transport.id, transport);

    const list = this.peerTransportsMap.get(wsId) ?? [];
    list.push( transport.id);
    this.peerTransportsMap.set(wsId, list);

    transport.on('dtlsstatechange', (dtlsState) => {
        if (dtlsState === 'closed') {
            log.debug({ transportId: transport.id }, 'Transport DTLS state closed, closing transport');
             transport.close();
             this.transportsMap.delete( transport.id);
        }
    });

    return {
        id:  transport.id,
        iceParameters:  transport.iceParameters,
        iceCandidates:  transport.iceCandidates,
        dtlsParameters:  transport.dtlsParameters,
    };
  }


  async connectTransport(transportId: string, dtlsParameters: mediasoupTypes.DtlsParameters) {
    const transport = this.transportsMap.get(transportId);
    if (!transport) throw new Error('Transport not found');
    await transport.connect({ dtlsParameters });
    log.info({ transportId }, 'Transport connected');
  }

  getTransport(transportId: string) {
    return this.transportsMap.get(transportId);
  }

  cleanupPeer(peerId: string) {
    const transportIds = this.peerTransportsMap.get(peerId);
    if (!transportIds) return;
    for (const id of transportIds) {
      const transport = this.transportsMap.get(id);
      if (transport) {
        transport.close();
        this.transportsMap.delete(id);
        log.info({ transportId: id, peerId }, 'Transport closed');
      }
    }
    this.peerTransportsMap.delete(peerId);
  }


  
}