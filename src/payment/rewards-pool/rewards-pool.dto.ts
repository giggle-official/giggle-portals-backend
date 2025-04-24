export class RewardAllocateAccount {
    address: string
    ratio: number
    type: "developer" | "platform" | "customized"
}

export class RewardModelDto {
    id: number
    ratio_detail: RewardAllocateAccount[]
    token_address: string
    pool_address: string
    created_at: Date
    updated_at: Date
}
