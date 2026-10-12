import { config as conf } from "dotenv";
import { log } from "node:console";
conf();

const _config = {
  port: process.env.PORT,
  serverUrl: process.env.SERVER_URL,
  logLevel: process.env.LOG_LEVEL,
  nodeEnv: process.env.NODE_ENV,
  jwtSecret: process.env.JWT_SECRET,
  announcedIp: process.env.ANNOUNCED_IP,
};

//console.log(_config)
export const env = Object.freeze(_config);