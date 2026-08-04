import { types as mediasoupTypes } from "mediasoup";
import { childLogger } from "src/tools/logger";
import { TransportManager } from "./transportManager";
import { WorkerManager } from "./workerManager";
import { Config } from "src/config/config";
import config from 'src/config/config.json' ;


const log = childLogger("media");
const configData: Config = config as Config;


export class ConsumerManager{
 
  constructor(
    private workerManager: WorkerManager,
    private transportManager: TransportManager,
  ) { }

  
  //create consumers
  
  async createConsumer(
      recvTransportId:string, 
      producerId:string, 
      rtpCapabilities:mediasoupTypes.RtpCapabilities
  ){
      if(!this.workerManager.getRouter()){
          throw new Error('Router not initialized');
      }
  
      const recvTransport = this.transportManager.getTransport(recvTransportId); //get the transportid from map
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
          log.debug('consumer transport closed');
      });
      
      consumer.on('producerclose', () => {
          log.debug('consumer producer closed');
      });
  
      log.info({ consumerId: consumer.id, transportId: recvTransport.id }, 'Consumer created');
  
      return {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
          type: consumer.type,
          producerPaused: consumer.producerPaused,
      };
  
  
  }
}