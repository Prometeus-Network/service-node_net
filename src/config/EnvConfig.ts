import {Env} from "env-decorator";

export class EnvConfig {
    @Env({required: true, type: "number"})
    SERVICE_NODE_API_PORT: number;

    @Env({required: true, type: "string"})
    DDS_API_BASE_URL: string;

    @Env({required: true, type: "string"})
    BILLING_API_BASE_URL: string;

    @Env({required: true, type: "string"})
    TEMPORARY_FILES_DIRECTORY: string;

    @Env({required: true, type: "string"})
    DDS_STUB_FILES_DIRECTORY: string;

    @Env({type: "string"})
    LOGGING_LEVEL: string = "INFO";

    @Env({required: true, type: "string"})
    NEDB_DIRECTORY: string;
}