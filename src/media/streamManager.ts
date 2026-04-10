import { types } from "mediasoup";
import { HLSConfig, StreamSession } from "src/config";
import {types as mediasoupTypes} from "mediasoup";


class StreamManager{
    private sessions : Map<string, StreamSession>;
    private config : HLSConfig;
    private nextRtpPort : number;
    
    constructor(){

    }

    //start hls stream
    async startHLSStream(
        roomId:number,
        producer : mediasoupTypes.Producer<mediasoupTypes.AppData>,
        router: mediasoupTypes.Router<mediasoupTypes.AppData>
    ): Promise<void>{

        //check if already streaming 


        //get free rtp ports
    }
}