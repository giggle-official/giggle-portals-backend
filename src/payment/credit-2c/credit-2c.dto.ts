export class Credit2cResponse<T> {
    data: T
    msg: string
    code: number
}

export class Credit2cBalanceDto {
    balance: number
}

export class Credit2cPaymentCallbackDto {
    order_id: string
}
