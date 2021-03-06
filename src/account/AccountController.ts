import {Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post} from "@nestjs/common";
import {AccountService} from "./AccountService";
import {RegisterAccountDto} from "./types/request";
import {
    AccountRegistrationStatusResponse,
    BalanceOfAccountResponse,
    BalancesOfLocalAccountsResponse,
    DataOwnersOfDataValidatorResponse,
    LocalAccountResponse
} from "./types/response";

@Controller("api/v1/accounts")
export class AccountController {
    constructor(private readonly accountService: AccountService) {
    }

    @Post()
    @HttpCode(HttpStatus.CREATED)
    public async registerAccount(@Body() registerAccountDto: RegisterAccountDto): Promise<void> {
        await this.accountService.registerAccount(registerAccountDto);
    }

    @Get("data-validators/:address/data-owners")
    public getDataOwnersOfDataValidator(@Param("address") address: string): Promise<DataOwnersOfDataValidatorResponse> {
        return this.accountService.getDataOwnersOfDataValidator(address);
    }

    @Get()
    public getLocalAccounts(): Promise<LocalAccountResponse[]> {
        return this.accountService.getAllLocalAccounts();
    }

    @Get(":address/balance")
    public getBalanceOfAccount(@Param("address") address: string): Promise<BalanceOfAccountResponse> {
        return this.accountService.getBalanceOfAccount(address);
    }

    @Get(":address/is-registered")
    public isAccountRegistered(@Param("address") address: string): Promise<AccountRegistrationStatusResponse> {
        return this.accountService.isAccountRegistered(address);
    }

    @Get("balances")
    public getBalancesOfLocalAccounts(): Promise<BalancesOfLocalAccountsResponse> {
        return this.accountService.getBalancesOfLocalAccounts();
    }

    @Patch(":address/default")
    public async setDefaultAccount(@Param("address") address: string): Promise<void> {
        await this.accountService.setDefaultAccount(address);
    }
}
