import "reflect-metadata";
import * as dotenv from "dotenv";

dotenv.config();

import { configureContainer } from "./di/container";
import { createApp } from "./app";

configureContainer();

const app = createApp();
const port = Number(process.env.PORT) || 4000;

app.listen(port, () => {
  console.log(`Scaler backend listening on port ${port} (APP_ENV=${process.env.APP_ENV || "local"})`);
});
