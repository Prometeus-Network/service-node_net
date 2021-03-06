import {HttpException, HttpStatus, Injectable} from "@nestjs/common";
import uuid from "uuid/v4";
import fileSystem from "fs";
import {addMonths, differenceInSeconds, parse} from "date-fns";
import {Response} from "express";
import {LoggerService} from "nest-logger";
import {FileUploadingStage} from "./types";
import {
    CreateLocalFileRecordDto,
    ExtendFileStorageDurationDto,
    UploadChunkDto,
    UploadLocalFileToDdsDto
} from "./types/request";
import {DdsFileResponse, DdsFileUploadCheckResponse, LocalFileRecordResponse} from "./types/response";
import {LocalFileRecord} from "./LocalFileRecord";
import {
    billingFileToDdsFileResponse,
    createDdsFileUploadCheckResponseFromLocalFileRecord,
    createLocalFileRecordDtoToLocalFileRecord,
    localFileRecordToDdsFileResponse,
    localFileRecordToDdsUploadRequest,
    localFileRecordToLocalFileRecordResponse,
    localFileRecordToPayForDataUploadRequest
} from "./mappers";
import {LocalFileRecordRepository} from "./LocalFileRecordRepository";
import {config} from "../config";
import {DdsApiClient} from "../dds-api";
import {BillingApiClient} from "../billing-api";
import {AccountService} from "../account";
import {UploadFileRequest} from "../dds-api/types/request";
import {DdsApiResponse} from "../dds-api/types/response";
import {DdsFileInfo} from "../dds-api/types";
import {PayForDataUploadResponse} from "../billing-api/types/response";
import {Web3Wrapper} from "../web3";
import {ISignedRequest} from "../web3/types";
import {GetFileKeyRequest} from "../data-validator-api/types/request";
import {FileKey} from "../purchase/types/response";
import {DataValidatorApiClientFactory} from "../data-validator-api";
import {DiscoveryService} from "../discovery";
import {NodeResponse} from "../discovery/types/response";
import {NodeType} from "../discovery/types";

@Injectable()
export class FileService {
    constructor(
        private readonly localFileRecordRepository: LocalFileRecordRepository,
        private readonly billingApiClient: BillingApiClient,
        private readonly ddsApiClient: DdsApiClient,
        private readonly dataValidatorApiClientFactory: DataValidatorApiClientFactory,
        private readonly discoveryService: DiscoveryService,
        private readonly accountService: AccountService,
        private readonly web3Wrapper: Web3Wrapper,
        private readonly log: LoggerService
    ) {
    }

    public async getFile(fileId: string, httpResponse: Response): Promise<void> {
        try {
            this.log.debug(`Retrieving file with id ${fileId}`);
            /*
            const {data} = await this.ddsApiClient.getFile(fileId);
            this.log.debug(`Retrieved file with id ${fileId}`);
            httpResponse.header("Content-Disposition", `attachment; filename=${fileId}`);
            data.pipe(httpResponse);*/
            httpResponse.download(`${process.env.DDS_STUB_FILES_DIRECTORY}/${fileId}`);
        } catch (error) {
            console.log(error);
            throw error;
        }
    }

    public async getFiles(page: number, pageSize: number): Promise<DdsFileResponse[]> {
        try {
            const files = (await this.billingApiClient.getFiles(page, pageSize)).data.data;
            return files.map(billingFile => billingFileToDdsFileResponse(billingFile));
        } catch (error) {
            if (error.response) {
                this.log.error(`Billing API responded with ${error.response.status} status`);
                console.log(error.response.data);
                throw new HttpException(`Billing API responded with ${error.response.status} status`, HttpStatus.INTERNAL_SERVER_ERROR);
            } else {
                this.log.error("Billing API is unreachable");
                throw new HttpException("Billing API is unreachable", HttpStatus.INTERNAL_SERVER_ERROR);
            }
        }
    }

    public async getFileInfo(fileId: string): Promise<DdsFileResponse> {
        const localFile = await this.localFileRecordRepository.findByDdsId(fileId);
        return localFileRecordToDdsFileResponse(localFile);
    }

    public async extendFileStorageDuration(fileId: string, extendFileStorageDurationDto: ExtendFileStorageDurationDto): Promise<{success: boolean}> {
        this.log.debug(`Extending storage duration of file ${fileId}`);
        const extendStorageDurationResponse = (await this.ddsApiClient.extendFileStorageDuration(
            fileId,
            {
                duration: differenceInSeconds(
                    parse(
                        extendFileStorageDurationDto.keepUntil,
                        "yyyy-MM-dd'T'hh:mm:ss'Z'",
                        addMonths(new Date(), 1)
                    ),
                    new Date()
                )
            }
        )).data;

        const file = await this.localFileRecordRepository.findByDdsId(fileId);

        await this.billingApiClient.payForStorageDurationExtension({
            sum: extendStorageDurationResponse.data.attributes.price + "",
            serviceNode: file.serviceNodeAddress,
            dataValidator: file.dataValidatorAddress,
            signature: extendFileStorageDurationDto.signature
        });

        await this.ddsApiClient.notifyPaymentStatus({
            status: "success",
            file_id: fileId,
            amount: extendStorageDurationResponse.data.attributes.price
        });

        return {success: true};
    }

    public async createLocalFileRecord(createLocalFileRecordDto: CreateLocalFileRecordDto): Promise<LocalFileRecordResponse> {
        try {
            this.log.debug("Creating new local file record");
            const fileId = uuid();
            const serviceNodeAddress = (await this.accountService.getDefaultAccount()).address;
            const localPath = `${config.TEMPORARY_FILES_DIRECTORY}/${fileId}`;
            fileSystem.closeSync(fileSystem.openSync(localPath, "w"));
            const localFile: LocalFileRecord = createLocalFileRecordDtoToLocalFileRecord(
                createLocalFileRecordDto,
                fileId,
                localPath,
                serviceNodeAddress
            );

            this.log.debug(`Created new local file record with id ${fileId}`);

            return this.localFileRecordRepository.save(localFile).then(saved => localFileRecordToLocalFileRecordResponse(saved));
        } catch (error) {
            console.log(error);
            throw error;
        }
    }

    public async deleteLocalFileRecord(localFileId: string): Promise<void> {
        this.log.debug(`Deleting local file record with id ${localFileId}`);
        const localFileRecord = await this.localFileRecordRepository.findById(localFileId);

        if (!localFileRecord) {
            throw new HttpException(`Could not find local file with id ${localFileId}`, HttpStatus.NOT_FOUND);
        }

        if (localFileRecord.deletedLocally) {
            throw new HttpException(`Local file with id ${localFileId} has already been deleted`, HttpStatus.CONFLICT);
        }

        if (fileSystem.existsSync(localFileRecord.localPath)) {
            try {
                fileSystem.unlinkSync(localFileRecord.localPath);
                localFileRecord.deletedLocally = true;
                this.log.debug(`Deleted local file record with id ${localFileId}`);
                await this.localFileRecordRepository.save(localFileRecord);
            } catch (error) {
                this.log.error(`Error occurred when tried to delete local file with id ${localFileId}`);
                console.log(error);
            }
        }
    }

    public async writeFileChunk(localFileId: string, uploadChunkDto: UploadChunkDto): Promise<{success: boolean}> {
        const localFile = await this.localFileRecordRepository.findById(localFileId);

        if (localFile) {
            this.log.debug(`Writing new chunk of file ${localFileId}`);
            fileSystem.appendFileSync(localFile.localPath, uploadChunkDto.chunkData);
            this.log.debug(`Completed writing new chunk of file ${localFileId}`);
            return {success: true};
        } else {
            throw new HttpException(`Could not find local file with id ${localFileId}`, HttpStatus.NOT_FOUND);
        }
    }

    public async checkLocalFileUploadStatus(localFileId: string): Promise<DdsFileUploadCheckResponse> {
        const localFile = await this.localFileRecordRepository.findById(localFileId);
        return createDdsFileUploadCheckResponseFromLocalFileRecord(localFile);
    }

    public async uploadLocalFileToDds(localFileId: string, uploadLocalFileToDdsDto: UploadLocalFileToDdsDto): Promise<{success: boolean}> {
        const localFile = await this.localFileRecordRepository.findById(localFileId);

        if (!localFile) {
            throw new HttpException(`Could not find local file with id ${localFileId}`, HttpStatus.NOT_FOUND);
        }

        if (!this.web3Wrapper.isSignatureValid(localFile.dataValidatorAddress, uploadLocalFileToDdsDto.signature)) {
            throw new HttpException(
                "Signature is invalid",
                HttpStatus.FORBIDDEN
            )
        }

        const data = fileSystem.readFileSync(localFile.localPath).toString();
        console.log(data);
        this.processDataUploading(localFile, uploadLocalFileToDdsDto, data);

        return {success: true};
    }

    private async processDataUploading(
        localFile: LocalFileRecord,
        uploadLocalFileToDdsDto: UploadLocalFileToDdsDto,
        data: string
    ): Promise<void> {
        this.log.debug(`Started processing data uploading - ${localFile._id}`);
        let stage: FileUploadingStage = FileUploadingStage.DDS_UPLOAD;

        try {
            this.log.debug(`Starting stage ${stage} - ${localFile._id}`);

            const uploadFileRequest = localFileRecordToDdsUploadRequest(localFile, data);
            const ddsResponse = await this.uploadFileToDds(uploadFileRequest);

            this.log.debug(`Stage ${stage} has been completed - ${localFile._id}`);
            this.log.debug(`Assigned DDS ID is ${ddsResponse.data.id} - ${localFile._id}`);
            stage = FileUploadingStage.BILLING_PROCESSING;
            this.log.debug(`Starting stage ${stage} - ${localFile._id}`);

            const payForDataUploadResponse = await this.payForDataUpload(
                localFile,
                ddsResponse.data.attributes.price,
                ddsResponse.data.id,
                uploadLocalFileToDdsDto.signature
            );

            this.log.debug(`Stage ${stage} has been completed - ${localFile._id}`);
            stage = FileUploadingStage.DDS_PAYMENT_NOTIFICATION;
            this.log.debug(`Starting stage ${stage} - ${localFile._id}`);

            /*await this.ddsApiClient.notifyPaymentStatus({
                file_id: ddsResponse.data.id,
                amount: ddsResponse.data.attributes.price,
                status: "success"
            });*/

            this.log.debug(`Stage ${stage} has been completed - ${localFile._id}`);

            localFile.failed = false;
            localFile.storagePrice = ddsResponse.data.attributes.price;
            localFile.ddsId = ddsResponse.data.id;
            localFile.uploadedToDds = true;
            localFile.dataOwnerAddress = payForDataUploadResponse.address;
            localFile.privateKey = payForDataUploadResponse.privateKey;

            await this.localFileRecordRepository.save(localFile);

            this.log.debug(`File uploading has been completed - ${localFile._id}`);
        } catch (error) {
            this.log.error(`Data upload failed at stage: ${stage}`);

            if (error.response) {
                console.log(error.response.data);
            }

            localFile.failed = true;

            await this.localFileRecordRepository.save(localFile);
        }
    }

    private async uploadFileToDds(uploadFileRequest: UploadFileRequest): Promise<DdsApiResponse<DdsFileInfo>> {
        return  (await this.ddsApiClient.uploadFile(uploadFileRequest)).data;
    }

    private async payForDataUpload(
        localFile: LocalFileRecord,
        price: number,
        fileId: string,
        signature: ISignedRequest
    ): Promise<PayForDataUploadResponse> {
        const payForDataUploadRequest = localFileRecordToPayForDataUploadRequest(localFile, price, fileId, signature);
        return (await this.billingApiClient.payForDataUpload(payForDataUploadRequest)).data;
    }

    public async getFileKey(fileId: string, getFileKeyRequest: GetFileKeyRequest): Promise<FileKey> {
        if (!this.web3Wrapper.isSignatureValid(getFileKeyRequest.address, getFileKeyRequest)) {
            throw new HttpException(
                `Signature is invalid`,
                HttpStatus.FORBIDDEN
            );
        }

        const dataValidatorNode = await this.lookForNodeWhichHasFile(fileId, getFileKeyRequest.dataValidatorAddress);
        const dataValidatorApiClient = this.dataValidatorApiClientFactory.createDataValidatorApiClientInstance({
            scheme: "http",
            port: dataValidatorNode.port,
            ipAddress: dataValidatorNode.ipAddress
        });

        try {
            return (await dataValidatorApiClient.getFileKey(fileId, getFileKeyRequest)).data;
        } catch (error) {
            this.log.error(`Error occurred when tried to get file key from data validator node with ip ${dataValidatorNode.ipAddress}`);
            console.log(error);
            throw new HttpException(
                `Error occurred when tried to get file key to file with if ${fileId}`,
                HttpStatus.INTERNAL_SERVER_ERROR
            );
        }
    }

    private async lookForNodeWhichHasFile(fileId: string, dataValidatorAddress: string): Promise<NodeResponse> {
        const dataValidatorNodes = await this.discoveryService.getNodesByAddressAndType(
            dataValidatorAddress,
            NodeType.DATA_VALIDATOR_NODE
        );

        if (dataValidatorNodes.length === 0) {
            throw new HttpException(
                `Could not find any data validator node with ${dataValidatorAddress} address`,
                HttpStatus.NOT_FOUND
            )
        }

        let nodePossessingFile: NodeResponse | undefined;

        for (const nodeInstance of dataValidatorNodes) {
            try {
                const dataValidatorApiClient = this.dataValidatorApiClientFactory.createDataValidatorApiClientInstance({
                    scheme: "http",
                    ipAddress: nodeInstance.ipAddress,
                    port: nodeInstance.port
                });
                const nodeHasFile = await dataValidatorApiClient.checkIfNodeHasFile(fileId);

                if (nodeHasFile) {
                    nodePossessingFile = nodeInstance;
                } else {
                    this.log.info(`Seems like data validator node with id ${nodeInstance.id} does not posses file with id ${fileId}, trying next one`)
                }

                break;
            } catch (error) {
                console.log(error);
                this.log.info(`Seems like data validator node with id ${nodeInstance.id} does not posses file with id ${fileId}, trying next one`)
            }
        }

        if (!nodePossessingFile) {
            throw new HttpException(
                `Could not find any data validator node which posseses file with id ${fileId}`,
                HttpStatus.SERVICE_UNAVAILABLE
            )
        }

        return nodePossessingFile;
    }
}
