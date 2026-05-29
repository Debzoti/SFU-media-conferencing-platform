import { config as conf } from "dotenv";
conf();

const _config = {
     port: process.env.PORT,
     serverUrl : process.env.SERVER_URL,
     nodeEnv: process.env.NODE_ENV,
     jwtSecret: process.env.JWT_SECRET

};

//console.log(_config)
export const env = Object.freeze(_config);