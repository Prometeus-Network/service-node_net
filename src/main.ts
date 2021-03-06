import {config} from "dotenv";
config();

import {NestFactory} from "@nestjs/core";
import {ValidationPipe} from "@nestjs/common";
import bodyParser from "body-parser";
import {AppModule} from "./AppModule";
import {config as envConfig} from "./config";

async function bootstrap() {
    const app = await NestFactory.create(AppModule);
    app.use(bodyParser.json({limit: "500mb"}));
    app.enableCors();
    app.enableShutdownHooks();
    app.useGlobalPipes(new ValidationPipe());
    await app.listen(envConfig.SERVICE_NODE_API_PORT);
}

bootstrap();
