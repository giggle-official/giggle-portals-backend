import { Inject, Injectable, Logger, forwardRef } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { PushIpToChainResponseDto, RegisterTokenResponseDto, UntokenizeResponseDto } from "./ip-on-chain.dto"
import { IpLibraryService } from "src/ip-library/ip-library.service"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import { PinataSDK } from "pinata-web3"
import { HttpService } from "@nestjs/axios"
import { lastValueFrom } from "rxjs"
import { AxiosResponse } from "axios"
import { CreateIpTokenGiggleResponseDto } from "../giggle/giggle.dto"
@Injectable()
export class IpOnChainService {
    private readonly ipOnChainEndpoint: string
    private readonly ipOnChainToken: string
    private readonly ipfsPrefix: string
    private readonly logger = new Logger(IpOnChainService.name)
    private readonly requestTimeout = 60000 //60 seconds
    constructor(
        private readonly prismaService: PrismaService,

        @Inject(forwardRef(() => IpLibraryService))
        private readonly ipLibraryService: IpLibraryService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        private readonly httpService: HttpService,
    ) {
        this.ipOnChainEndpoint = process.env.IP_ON_CHAIN_ENDPOINT
        this.ipOnChainToken = process.env.IP_ON_CHAIN_TOKEN
        this.ipfsPrefix = "https://ipfs.io/ipfs/"
        if (!this.ipOnChainEndpoint || !this.ipOnChainToken) {
            throw new Error("IP on chain endpoint or token is not set")
        }
    }

    async pushIpToChain(userInfo: UserInfoDTO, ip_id: number): Promise<PushIpToChainResponseDto> {
        let onChainRequestParams: any
        let functionName = "RegisterIP"
        try {
            const ip = await this.ipLibraryService.detail(ip_id.toString(), null)
            const user = await this.userService.getProfile(userInfo)

            if (!ip) {
                throw new Error("Ip not found")
            }

            if (ip.on_chain_status === "onChain") {
                functionName = "UpdateIP"
            }

            //update ip metadata and authorization settings to ipfs
            const ipMetadata = {
                id: ip.id,
                owner: user.email,
                name: ip.name,
                ticker: ip.ticker,
                description: ip.description,
                cover_image: `${this.ipfsPrefix}${ip.cover_hash}`,
                cover_hash: ip.cover_hash,
                video_url: `${this.ipfsPrefix}${ip.ip_signature_clips[0].ipfs_hash}`,
                video_hash: ip.ip_signature_clips[0].ipfs_hash,
                type: ip.genre.map((g) => g.name).join(","),
                extra_info: ip.extra_info,
            }

            const authorizationSettings = ip.authorization_settings

            const pinata = new PinataSDK({
                pinataJwt: process.env.PINATA_JWT,
                pinataGateway: process.env.PINATA_GATEWAY,
            })

            const metaUriResponse = await pinata.upload.json(ipMetadata)
            const authorizationUriResponse = await pinata.upload.json(authorizationSettings)

            onChainRequestParams = {
                ipData: {
                    title: ip.name,
                    symbol: ip.ticker,
                    uri: `${this.ipfsPrefix}${ip.cover_hash}`,
                    ipType: ip.genre.map((g) => g.name).join(","),
                    metadataUri: `${this.ipfsPrefix}${metaUriResponse.IpfsHash}`,
                    metadataHash: metaUriResponse.IpfsHash,
                    licenseUri: `${this.ipfsPrefix}${authorizationUriResponse.IpfsHash}`,
                    licenseHash: authorizationUriResponse.IpfsHash,
                },
                parentAddr: ip.parent_ip_info?.[0]?.on_chain_detail?.ipAddr || "",
                __authToken: this.ipOnChainToken,
            }

            const onChainRequest = this.httpService.post(
                this.ipOnChainEndpoint + "/" + functionName,
                onChainRequestParams,
                {
                    timeout: this.requestTimeout,
                },
            )
            const onChainResponse: AxiosResponse<PushIpToChainResponseDto> = await lastValueFrom(onChainRequest)

            if (!onChainResponse.data.isSucc) {
                throw new Error(
                    "response: " +
                        JSON.stringify(onChainResponse.data.err) +
                        ",request: " +
                        JSON.stringify(onChainRequestParams),
                )
            }

            await this.prismaService.ip_library.update({
                where: { id: ip.id },
                data: {
                    meta_hash: metaUriResponse.IpfsHash,
                    authorization_hash: authorizationUriResponse.IpfsHash,
                    on_chain_request_params: onChainRequestParams,
                    on_chain_detail: onChainResponse.data.res as any,
                    on_chain_status: "onChain",
                },
            })

            return onChainResponse.data
        } catch (error) {
            this.logger.error("Error pushing ip to chain:", error)
            return { isSucc: false, err: { type: "error", message: error.message } }
        }
    }

    async registerToken(params: { ip_id: number; record_id: number }): Promise<RegisterTokenResponseDto> {
        let registerTokenRequestParams: any
        try {
            const ip = await this.ipLibraryService.detail(params.ip_id.toString(), null)
            if (!ip || !ip?.on_chain_detail?.ipAddr) {
                throw new Error("Ip not found or ip not on chain")
            }

            const ipAddr = ip.on_chain_detail.ipAddr

            const memeRecord = await this.prismaService.asset_to_meme_record.findUnique({
                where: { id: params.record_id },
            })

            if (!memeRecord) {
                throw new Error("Meme record not found")
            }

            const memeDetail = memeRecord.token_info as any as CreateIpTokenGiggleResponseDto

            if (!memeDetail.user_address || !memeDetail.mint) {
                throw new Error("Meme detail not found")
            }

            registerTokenRequestParams = {
                ipAddr: ipAddr,
                tokenAddr: memeDetail.mint,
                creator: memeDetail.user_address,
                __authToken: this.ipOnChainToken,
            }

            const registerTokenRequest = this.httpService.post(
                this.ipOnChainEndpoint + "/RegisterToken",
                registerTokenRequestParams,
                {
                    timeout: this.requestTimeout,
                },
            )
            const registerTokenResponse: AxiosResponse<RegisterTokenResponseDto> =
                await lastValueFrom(registerTokenRequest)

            if (!registerTokenResponse.data.isSucc) {
                throw new Error(
                    "Failed to register token: " +
                        registerTokenResponse.data.err.message +
                        "request: " +
                        JSON.stringify(registerTokenRequestParams),
                )
            }

            await this.prismaService.asset_to_meme_record.update({
                where: { id: params.record_id },
                data: {
                    token_registered: true,
                    token_registered_info: registerTokenResponse.data.res as any,
                },
            })

            return registerTokenResponse.data
        } catch (error) {
            this.logger.error("Error registering token:", error)
            return { isSucc: false, err: { type: "error", message: error.message } }
        }
    }

    async untokenize(ipAddr: string): Promise<UntokenizeResponseDto> {
        try {
            let untokenizeRequestParams: any
            untokenizeRequestParams = {
                ipAddr: ipAddr,
                __authToken: this.ipOnChainToken,
            }

            const untokenizeRequest = this.httpService.post(
                this.ipOnChainEndpoint + "/UnRegisterToken",
                untokenizeRequestParams,
                { timeout: this.requestTimeout },
            )

            const untokenizeResponse: AxiosResponse<UntokenizeResponseDto> = await lastValueFrom(untokenizeRequest)

            if (!untokenizeResponse.data.isSucc) {
                this.logger.error("Failed to untokenize: " + untokenizeResponse.data.err.message)
                throw new Error("Failed to untokenize: " + untokenizeResponse.data.err.message)
            }
            return untokenizeResponse.data
        } catch (error) {
            this.logger.error("Error untokenizing:", error)
            return { isSucc: false, err: { type: "error", message: error.message } }
        }
    }
}
