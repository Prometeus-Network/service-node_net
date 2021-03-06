import {ISignedRequest} from "../../../web3/types";

export interface PayForDataPurchaseRequest {
    id: string,
    owner: string,
    data_validator: string,
    sum: string,
    service_node: string,
    data_owner: string,
    data_mart: string,
    signature: ISignedRequest
}
