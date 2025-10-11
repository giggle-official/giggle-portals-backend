export class CreatePoolDto {
    token_mint: string
    user_wallet: string
    email: string
}

export class RpcResponseDto<T> {
    isSucc: boolean
    res: T
}

export class CreatePoolResponseDto {
    tx: string
}

export class InjectTokenResponseDto {
    tx: string
}

export class AirdropResponseDto {
    tx: string
}

export class RetrieveResponseDto {
    bump: number
    creator: string
    mintToCreatefi: string
    totalAmount: string
}

export class RetrieveUserTokenBalanceResponseDto {
    bump: number
    owner: string
    totalAmount: number
    lockedAmount: number
    availableAmount: number
    initialized: boolean
    releaseStart: number
    releaseDayCount: number
}

export class InjectTokenDto {
    token_mint: string
    user_wallet: string
    email: string
    amount: number
}

export class TransactionDto {
    tx: string
    signature: string
    request_params: any
}

export class AllocateRevenueDto {
    token_mint: string
    revenue: number
    paid_time: number
    revenue_allocate_details: {
        wallet_address: string
        share: number
        token: 1 | 0
    }[]
}

export class AirdropStatementToChainDto {
    user_wallet: string
    owner_wallet: string
    token: string
    amount: number
    dropNow: number
    releaseDayCount: number
    timestamp: number
}

export class WithdrawTokenToWalletDto {
    user_wallet: string
    amount: number
    token: string
}

export class WithdrawTokenToWalletResponseDto {
    tx: string
}

export class BuyBackRecord {
    id: number
    addr: string
    number: string
    sig: string
    time: number
    status: 1 | 2
}

export class BuybackRecordResponseDto {
    arr: BuyBackRecord[]
}

export class BuybackOrderStatusResponseDto {
    status: number
    arr: BuyBackRecord[]
    msg: string
}
