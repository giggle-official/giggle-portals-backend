import { ApiProperty } from "@nestjs/swagger"

export class IpToChainResDto<T> {
    isSucc: boolean
    res?: T
    err?: {
        type: string
        message: any
    }
}

export class OnChainDetailDto {
    @ApiProperty({
        description: "ip address of the ip library",
    })
    ipAddr: string

    @ApiProperty({
        description: "signature of the ip library",
    })
    signature: string
}

export class RegisterTokenRequestDto {
    signature: string
}

export class LaunchStaticTokeResDto {
    tokenAddr: string
    txIds: string
    metadataHash: string
}

export class PushIpToChainResponseDto extends IpToChainResDto<OnChainDetailDto> {}

export class RegisterTokenResponseDto extends IpToChainResDto<RegisterTokenRequestDto> {}

export class UntokenizeResponseDto extends IpToChainResDto<RegisterTokenRequestDto> {}

export class LaunchStaticTokenResponseDto extends IpToChainResDto<LaunchStaticTokeResDto> {}
