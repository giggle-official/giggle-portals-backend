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

export class RetrieveResponseDto {
    content: any
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
