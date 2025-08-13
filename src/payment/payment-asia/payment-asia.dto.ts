export enum PaymentAsiaOrderStatus {
    PENDING = "0",
    SUCCESS = "1",
    FAIL = "2",
    PROCESSING = "4",
}

export enum PaymentAsiaNetwork {
    ALIPAY = "Alipay",
    WECHAT = "Wechat",
    USER_DEFINE = "UserDefine",
    CREDIT_CARD = "CreditCard",
}

export class CreatePaymentOrderRequestDto {
    merchant_reference: string
    currency: "HKD"
    amount: string
    return_url?: string
    customer_ip: string
    customer_first_name: string
    customer_last_name: string
    customer_phone: string
    customer_email: string
    customer_address?: string
    customer_state?: string
    customer_postal_code?: string
    customer_country?: string
    network: PaymentAsiaNetwork
    subject: string
    notify_url: string
}

export class CreatePaymentOrderResDto {
    merchant_reference: string
    request_reference: string
    currency: string
    amount: string
    status: PaymentAsiaOrderStatus
    sign: string
}

export class PaymentAsiaCallbackDto {
    amount: string
    currency: string
    request_reference: string
    merchant_reference: string
    status: PaymentAsiaOrderStatus
    sign: string
}
