// tslint:disable:interface-name

import {FileMetadata} from "../dto";

export enum EntityType {
    ACCOUNT = "account",
    LOCAL_FILE_RECORD = "localFileRecord",
    DATA_OWNERS_OF_DATA_VALIDATOR = "dataOwnersOfDataValidator"
}

export interface IBaseEntity {
    _type: EntityType,
    _id?: string
}

export interface Account extends IBaseEntity{
    address: string,
    accountType: string,
    default: boolean
}

export interface LocalFileRecord extends IBaseEntity {
    name: string,
    localPath: string,
    extension: string,
    mimeType: string,
    size: number,
    metadata: FileMetadata,
    serviceNodeAddress: string,
    dataValidatorAddress: string,
    dataOwnerAddress?: string,
    privateKey?: string,
    keepUntil: string,
    uploadedToDds: boolean,
    failed: boolean,
    ddsId?: string,
    price: number,
    storagePrice?: number,
    deletedLocally: boolean,
}

export interface DataOwnersOfDataValidator extends IBaseEntity {
    dataValidatorAddress: string,
    dataOwners: string[]
}
