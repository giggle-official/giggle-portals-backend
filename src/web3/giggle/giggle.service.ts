import { HttpService } from "@nestjs/axios"
import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
} from "@nestjs/common"
import * as crypto from "crypto"
import { lastValueFrom, Observable, Subscriber } from "rxjs"
import {
    ConfirmStatus,
    CreateIpTokenDto,
    CreateIpTokenGiggleRequestDto,
    CreateIpTokenGiggleResponseDto,
    GetIpTokenListQueryDto,
    GetIpTokenListResponseDto,
    GetUploadTokenResponseDto,
    GiggleApiResponseDto,
    HolderDto,
    PaymentCallbackDto,
    PaymentDto,
    PaymentResponseDto,
    SendTokenDto,
    SendTokenResponseDto,
    SSEMessage,
    SwapUsdcToSolResponseDto,
    TopUpResponseDto,
    TradeDto,
    TradeResponseFromGiggleDto,
    TradeStatus,
    UploadCoverImageResponseDto,
    UserMarketCapDto,
    WalletCoinSummaryDto,
    WalletDetailDto,
} from "./giggle.dto"
import { AxiosResponse } from "axios"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { PassThrough } from "stream"
import { UserJwtExtractDto } from "src/user/user.controller"
import { LogsService } from "src/user/logs/logs.service"
import { Cron } from "@nestjs/schedule"
import { CronExpression } from "@nestjs/schedule"
import { assets, Prisma } from "@prisma/client"
import FormData from "form-data"
import { HttpsProxyAgent } from "https-proxy-agent"
import axios from "axios"
import https from "https"
import { IpEvents, IpEventsDetail } from "src/ip-library/ip-library.dto"
import { STATIC_TOKENS } from "src/common/static-tokens"
import { RewardsPoolService } from "src/payment/rewards-pool/rewards-pool.service"
import { Decimal } from "@prisma/client/runtime/library"
import { CACHE_MANAGER } from "@nestjs/cache-manager"
import { Cache } from "cache-manager"

@Injectable()
export class GiggleService {
    private readonly appid: string
    private readonly apiKey: string
    private readonly endpoint: string
    private readonly requestTimeout = 180000 //180 seconds
    private readonly legalUsdcPOW: number = parseInt(process.env.GIGGLE_LEGAL_USDC_POW || "1") //using for usdc mint

    public static readonly GIGGLE_LEGAL_USDC: string = process.env.GIGGLE_LEGAL_USDC || ""

    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,
        private readonly logService: LogsService,
        private readonly web3HttpService: HttpService,

        @Inject(CACHE_MANAGER) private cacheManager: Cache,

        @Inject(forwardRef(() => RewardsPoolService))
        private readonly rewardsPoolService: RewardsPoolService,
    ) {
        this.appid = process.env.GIGGLE_APP_ID
        this.apiKey = process.env.GIGGLE_API_KEY
        this.endpoint = process.env.GIGGLE_ENDPOINT
        if (!this.appid || !this.apiKey || !this.endpoint) {
            throw new Error("Giggle appId, apiKey, or endpoint is not set")
        }

        if (!GiggleService.GIGGLE_LEGAL_USDC) {
            throw new InternalServerErrorException("GIGGLE_LEGAL_USDC is not set")
        }

        if (process.env.HTTP_PROXY) {
            this.web3HttpService = new HttpService(
                axios.create({
                    httpsAgent: new HttpsProxyAgent(process.env.HTTP_PROXY, { keepAlive: false }),
                }),
            )
        } else {
            this.web3HttpService = new HttpService(
                axios.create({
                    httpsAgent: new https.Agent({ keepAlive: false }),
                }),
            )
        }
    }

    private readonly logger = new Logger(GiggleService.name)

    public readonly creditPriceMax = 10000
    public readonly creditPriceMin = 500
    public readonly creditMarketCapPercentage = 0.1

    private readonly badIpfsKey = [
        "QmbF6AKvzZ2fV7GubWq9v2P6qLMXyL6Y4ebZY8hrBng7QU",
        "bafybeig5ayz3x52765pjdfb2imqz4otybiih3x4i6nymtwcywnde5t64ym",
    ]

    generateSignature(params: Record<string, any>): Record<string, any> {
        const timestamp = Math.floor(Date.now() / 1000)
        params.timestamp = timestamp
        params.appid = this.appid
        const sortedKeys = Object.keys(params)
            .filter((key) => key !== "sign" && params[key] !== undefined && params[key] !== null)
            .sort()
        const stringA = sortedKeys
            .map(
                (key) =>
                    `${key}=${typeof params[key] === "object" ? JSON.stringify(this.recursiveSortObjectByKey(params[key])) : params[key]}`,
            )
            .join(",")
        const stringSignTemp = `${stringA},key=${this.apiKey}`
        const hash = crypto.createHash("md5").update(stringSignTemp).digest("hex")

        return {
            ...params,
            sign: hash.toUpperCase(),
        }
    }

    /**
     * Recursively sorts an object by its keys
     * @param obj - The object to sort
     * @param sortFn - Optional custom sort function for keys (default: alphabetical)
     * @returns A new object with sorted keys at all levels
     */
    recursiveSortObjectByKey(obj: any, sortFn?: (a: string, b: string) => number): any {
        // Handle null, undefined, or primitive values
        if (obj === null || obj === undefined || typeof obj !== "object") {
            return obj
        }

        // Handle arrays - recursively sort each element
        if (Array.isArray(obj)) {
            return obj.map((item) => this.recursiveSortObjectByKey(item, sortFn))
        }

        // Handle Date objects and other built-in objects
        if (obj instanceof Date || obj instanceof RegExp || obj instanceof Error) {
            return obj
        }

        // Handle plain objects - sort keys and recursively sort values
        const keys = Object.keys(obj)
        const sortedKeys = sortFn ? keys.sort(sortFn) : keys.sort()
        const sortedObj: any = {}

        for (const key of sortedKeys) {
            sortedObj[key] = this.recursiveSortObjectByKey(obj[key], sortFn)
        }

        return sortedObj
    }

    //

    async uploadCoverImageFromS3(path: string): Promise<UploadCoverImageResponseDto> {
        try {
            const url = this.endpoint

            const formData = new FormData()
            const params = this.generateSignature({})
            Object.keys(params).forEach((key) => {
                formData.append(key, params[key])
            })

            const s3Client = await this.utilitiesService.getS3Client(false)
            const s3Info = await this.utilitiesService.getS3Info(false)
            let fileInfo = null
            try {
                fileInfo = await s3Client.headObject({ Bucket: s3Info.s3_bucket, Key: path }).promise()
            } catch (error) {
                throw new BadRequestException("File not found")
            }

            const fileStream = s3Client.getObject({ Bucket: s3Info.s3_bucket, Key: path }).createReadStream()

            const chunks: Buffer[] = []
            for await (const chunk of fileStream) {
                chunks.push(chunk)
            }
            const fileBuffer = Buffer.concat(chunks)

            const fileExtension = path.split(".").pop()
            const randomFileName = `${Math.random().toString(36).substring(2, 15)}-${Math.random().toString(36).substring(2, 15)}.${fileExtension}`
            formData.append("file", fileBuffer, { filename: randomFileName, contentType: fileInfo.ContentType })

            const headers = formData.getHeaders()
            const request = this.web3HttpService.post(url + "/cus/ipfs", formData, headers)
            const response: AxiosResponse<GiggleApiResponseDto<UploadCoverImageResponseDto>> =
                await lastValueFrom(request)

            if (response.data.code !== 0) {
                throw new BadRequestException("Failed to upload cover image: " + response.data.msg)
            }
            return response.data.data
        } catch (error) {
            this.logger.error(error)
            throw new Error("Failed to upload cover image")
        }
    }

    async uploadCoverImage(file: Express.Multer.File): Promise<UploadCoverImageResponseDto> {
        try {
            const url = this.endpoint
            const formData = new FormData()
            const params = this.generateSignature({})
            Object.keys(params).forEach((key) => {
                formData.append(key, params[key])
            })

            const blob = new Blob([file.buffer as any], { type: file.mimetype })
            formData.append("file", blob, file.originalname)

            const headers = {
                "Content-Type": "multipart/form-data",
            }
            const request = this.web3HttpService.post(url + "/cus/ipfs", formData, { headers })
            const response: AxiosResponse<GiggleApiResponseDto<UploadCoverImageResponseDto>> =
                await lastValueFrom(request)

            if (response.data.code !== 0) {
                throw new BadRequestException("Failed to upload cover image: " + response.data.msg)
            }
            return response.data.data
        } catch (error) {
            this.logger.error(error)
            throw new Error("Failed to upload cover image")
        }
    }

    async signTest(params: Record<string, any>): Promise<Record<string, any>> {
        const signature = this.generateSignature({ ...params, a: "b" })
        const response = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/sign/test", signature, {
                headers: { "Content-Type": "application/json" },
                timeout: this.requestTimeout,
            }),
        )
        return response.data
    }

    createIpToken(userInfo: UserJwtExtractDto, ipId: number, params: CreateIpTokenDto): Observable<SSEMessage> {
        return new Observable((subscriber) => {
            this.processIpToken(userInfo, ipId, params, subscriber).catch((error) => {
                subscriber.error(error)
            })
        })
    }

    async processIpToken(
        userInfo: UserJwtExtractDto,
        ipId: number,
        params: CreateIpTokenDto,
        subscriber: Subscriber<SSEMessage>,
        completeSubscriber: boolean = true,
    ): Promise<CreateIpTokenGiggleResponseDto> {
        let mintParams: CreateIpTokenGiggleRequestDto | null = null
        let mintRes: CreateIpTokenGiggleResponseDto | null = null
        try {
            const user = await this.prismaService.users.findUnique({
                where: { username_in_be: userInfo.usernameShorted },
            })
            if (!user) {
                throw new BadRequestException("User not found")
            }

            let asset: assets | null = null
            let videoUrl: string = ""
            if (params.asset_id) {
                asset = await this.prismaService.assets.findUnique({
                    where: { asset_id: params.asset_id },
                    include: {
                        asset_related_ips: true,
                    },
                })
                if (!asset) {
                    throw new BadRequestException("Asset not found")
                }
                if (asset.type !== "video") {
                    throw new BadRequestException("Asset is not a video")
                }
                videoUrl = await this.uploadAsset(asset.path, subscriber)
            }

            mintParams = {
                email: user.email,
                name: params.name,
                coverUrl: params.cover_image,
                fileUrl: videoUrl || "",
                symbol: params.ticker,
                description: params.description,
                twitter: params?.twitter,
                telegram: params?.telegram,
                website: params?.website,
                isUsdc: true,
                amount: 0,
                sourceType: params.ip_type,
                metaData: params.metadata || {},
                //metaData: {},
            }

            if (params.buyAmount) {
                mintParams.amount = Number((params.buyAmount * this.legalUsdcPOW).toFixed(6))
            }

            if (params.cover_s3_key) {
                const uploadResult = await this.uploadCoverImageFromS3(params.cover_s3_key)
                mintParams.coverUrl = uploadResult.url
            }

            subscriber.next({
                event: IpEvents.IP_TOKEN_CREATING,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_TOKEN_CREATING),
            })

            this.logger.log("mintParams:" + JSON.stringify(mintParams))

            const signaturedParams = this.generateSignature(mintParams)
            const request = this.web3HttpService.post(this.endpoint + "/cus/mint", signaturedParams, {
                headers: { "Content-Type": "application/json" },
                timeout: this.requestTimeout,
            })
            const response: AxiosResponse<GiggleApiResponseDto<CreateIpTokenGiggleResponseDto>> =
                await lastValueFrom(request)

            this.logger.log("response:" + JSON.stringify(response.data))

            mintRes = response.data.data
            if (mintRes.status !== "completed") {
                this.logger.error(
                    "Failed to create meme:" + JSON.stringify(mintRes) + " response:" + JSON.stringify(response.data),
                )
                throw new BadRequestException("Failed to create meme")
            }

            //store meme info in db
            //await this.prismaService.asset_to_meme_record.create({
            //    data: {
            //        asset_id: asset ? asset.id : null,
            //        ip_id: [{ ip_id: ipId }],
            //        owner: user.username_in_be,
            //        mint_params: signaturedParams,
            //        status: mintRes.status,
            //        token_info: mintRes as any,
            //        token_registered: false,
            //        token_registered_info: null,
            //    },
            //})

            await this.logService.create(userInfo, {
                product: "web",
                action: "createMeme",
                detail: {
                    name: params.name,
                    ticker: params.ticker,
                    description: params.description,
                    cover_image: params.cover_image,
                    response: mintRes,
                },
                status: "success",
            })

            //subscriber.next({
            //    event: IpEvents.IP_TOKEN_CREATED_ON_CHAIN,
            //    event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_TOKEN_CREATED_ON_CHAIN),
            //    data: mintRes,
            //})
            if (completeSubscriber) {
                subscriber.complete()
            }
            return mintRes
        } catch (error) {
            this.logger.error(
                "Failed to create meme:" +
                    JSON.stringify(error) +
                    " mintParams:" +
                    JSON.stringify(mintParams) +
                    " mintRes:" +
                    JSON.stringify(mintRes),
            )
            if (!completeSubscriber) {
                throw error
            }
            subscriber.error(error)
            subscriber.complete()
        }
    }

    async pushStaticToken(params: CreateIpTokenDto, email: string, mint: string) {
        const mintParams: any = {
            email: email,
            name: params.name,
            coverUrl: params.cover_image,
            fileUrl: "",
            symbol: params.ticker,
            description: params.description,
            twitter: params?.twitter,
            telegram: params?.telegram,
            website: params?.website,
            isUsdc: true,
            amount: 0,
            sourceType: params.ip_type,
            metaData: params.metadata || {},
            isStatic: true,
            mint: mint,
            //metaData: {},
        }
        const signaturedParams = this.generateSignature(mintParams)
        const request = this.web3HttpService.post(this.endpoint + "/cus/mint", signaturedParams, {
            headers: { "Content-Type": "application/json" },
            timeout: this.requestTimeout,
        })
        const response: AxiosResponse<GiggleApiResponseDto<CreateIpTokenGiggleResponseDto>> =
            await lastValueFrom(request)

        this.logger.log(
            "push static token response:" +
                JSON.stringify(response.data) +
                `, request: ${JSON.stringify(signaturedParams)}`,
        )

        return response.data.data
    }

    private async uploadAsset(path: string, subscriber: Subscriber<SSEMessage>): Promise<string> {
        const fileName = path.split("/").pop()
        if (!fileName.endsWith(".mp4") && !fileName.endsWith(".mov") && !fileName.endsWith(".mkv")) {
            throw new BadRequestException("File is not a mp4 or mov or mkv video")
        }

        const contentType = "video/" + fileName.split(".").pop()
        const s3Info = await this.utilitiesService.getS3Info(false)

        const signatureParams = this.generateSignature({ fileName, scene: "createCoin" })
        const signedUrlResponse: AxiosResponse<GiggleApiResponseDto<GetUploadTokenResponseDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + `/cus/getUploadTool`, signatureParams, {
                headers: { "Content-Type": "application/json" },
                timeout: this.requestTimeout,
            }),
        )
        if (signedUrlResponse.data.code !== 0) {
            throw new BadRequestException("Failed to get upload token: " + signedUrlResponse.data.msg)
        }
        const signedUrl = signedUrlResponse.data.data.preSignedUrl

        const s3Client = await this.utilitiesService.getS3Client(false)
        const headObject = await s3Client.headObject({ Bucket: s3Info.s3_bucket, Key: path }).promise()
        const totalSize = headObject.ContentLength
        let uploadedSize = 0

        //sleep 500ms to wait for the file to be uploaded to s3
        await new Promise((resolve) => setTimeout(resolve, 500))

        const fileStream = s3Client.getObject({ Bucket: s3Info.s3_bucket, Key: path }).createReadStream()
        const uploadReq = this.web3HttpService.put(signedUrl, fileStream.pipe(new PassThrough()), {
            headers: { "Content-Type": contentType, "Content-Length": totalSize.toString() },
        })

        let currentProgress = 0
        let progressInterval: NodeJS.Timeout

        progressInterval = setInterval(() => {
            subscriber.next({
                event: IpEvents.IP_ASSET_TO_IPFS,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_ASSET_TO_IPFS),
                data: currentProgress,
            })
        }, 500)

        fileStream.on("data", (chunk) => {
            uploadedSize += chunk.length
            currentProgress = (uploadedSize / totalSize) * 100
        })

        fileStream.on("end", () => {
            clearInterval(progressInterval)
            subscriber.next({
                event: IpEvents.IP_ASSET_TO_IPFS,
                event_detail: IpEventsDetail.find((item) => item.event === IpEvents.IP_ASSET_TO_IPFS),
                data: 100,
            })
        })

        const response = await lastValueFrom(uploadReq)
        const url = new URL(signedUrl)

        if (response.status !== 200) {
            throw new BadRequestException("Failed to upload asset")
        }
        //remove leading slash
        return url.pathname.replace(/^\/+/, "")
    }

    async getIpTokenList(query: GetIpTokenListQueryDto): Promise<GetIpTokenListResponseDto> {
        const params: any = {
            page: parseInt(query?.page) || 0,
            pageSize: parseInt(query?.page_size) || 10,
            site: query?.site || "3body",
        }
        if (query?.mint) {
            params.mint = query.mint
                .split(",")
                .map((item) => item.trim())
                .join(",")
        }
        if (query?.addr) {
            params.addr = query.addr
        }
        const sigendParams = this.generateSignature(params)
        const response: AxiosResponse<GiggleApiResponseDto<GetIpTokenListResponseDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/mint/list", sigendParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error("Failed to get meme list: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to get meme list: " + response.data.msg)
        }
        const result = response?.data?.data?.data
        const filteredResult = await Promise.all(
            result.map(async (item: any) => {
                if (item.coverUrl.startsWith("https://ipfs.io")) {
                    item.coverUrl = item.coverUrl.replace("https://ipfs.io", "https://gateway.pinata.cloud")
                }

                if (this.badIpfsKey.some((key) => item.coverUrl.includes(key))) {
                    const ip = await this.prismaService.ip_library.findFirst({
                        where: { name: item.name },
                    })
                    if (ip) {
                        const coverKey = ip.cover_images?.[0].key
                        if (coverKey) {
                            item.coverUrl = await this.utilitiesService.createS3SignedUrl(coverKey)
                        }
                    }
                }

                item.credit_price = this.computeCreditPrice(Number(item.marketCap))
                return item
            }),
        )

        return {
            ...response.data.data,
            data: filteredResult,
        }
    }

    async getWalletBalance(walletAddress: string, mint?: string): Promise<{ mint: string; amount: string }[]> {
        const cacheKey = `wallet_balance_${walletAddress}_${mint}`
        const cachedData = await this.cacheManager.get(cacheKey)
        if (cachedData) {
            return cachedData as { mint: string; amount: string }[]
        }
        const params: any = { address: walletAddress }
        if (mint) {
            params.mint = mint
        }
        const signatureParams = this.generateSignature(params)
        const response: AxiosResponse<GiggleApiResponseDto<{ mint: string; amount: string }[]>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/user/balance", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error("Failed to get wallet balance: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to get wallet balance: " + response.data.msg)
        }
        const data = response.data.data
        this.logger.log(`set wallet balance to cache: ${cacheKey}`)
        await this.cacheManager.set(cacheKey, data, 5000) //5 seconds
        return data
    }

    async holder(params: HolderDto): Promise<any> {
        const signatureParams = this.generateSignature(params)
        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/holder", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )

        if (response.data.code !== 0) {
            this.logger.error("Failed to get holder: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to get holder: " + response.data.msg)
        }
        return response.data.data
    }

    async getUserWalletDetail(
        userInfo: UserJwtExtractDto,
        page: number = 1,
        pageSize: number = 10,
        mint?: string,
    ): Promise<WalletDetailDto> {
        //find from cache
        const cacheKey = `user_wallet_detail_${userInfo.usernameShorted}_${page}_${pageSize}_${mint}`
        const cachedData = await this.cacheManager.get(cacheKey)
        if (cachedData) {
            return cachedData as WalletDetailDto
        }
        const userEmail = await this.prismaService.users.findUnique({
            where: { username_in_be: userInfo.usernameShorted },
        })
        if (!userEmail) {
            throw new BadRequestException("User email not found")
        }
        const params: any = { email: userEmail.email, page, pageSize }
        if (mint) {
            params.mint = mint
        }
        const signatureParams = this.generateSignature(params)
        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/user/coins", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        let res: WalletDetailDto = {
            addr: "",
            total_balance: 0,
            formated_total_balance: "",
            ip_total_market_cap: 0,
            formated_market_cap: "",
            list: [],
            page: 0,
            page_size: 0,
        }
        if (response.data.code !== 0) {
            this.logger.error(
                `Failed to get user wallet detail: ${JSON.stringify(response.data)}, user: ${userEmail.email}, request: ${JSON.stringify(signatureParams)}`,
            )
            return res
        }
        const data = response.data.data
        this.logger.log("get user wallet detail data:" + JSON.stringify(data))
        res = {
            addr: data?.addr || "",
            total_balance: parseFloat(parseFloat(data?.totalBalance || 0).toFixed(2)),
            formated_total_balance: UtilitiesService.formatBigNumber(parseFloat(data?.totalBalance || 0)),
            ip_total_market_cap: parseFloat(data?.ipTotalMarketCap || 0),
            formated_market_cap: UtilitiesService.formatBigNumber(parseFloat(data?.ipTotalMarketCap || 0)),
            list: await Promise.all(
                data?.list?.map(async (item: any): Promise<WalletCoinSummaryDto> => {
                    if (this.badIpfsKey.some((key) => item.coverUrl.includes(key))) {
                        const ip = await this.prismaService.ip_library.findFirst({
                            where: { name: item.name },
                        })
                        if (ip) {
                            const coverKey = ip.cover_images?.[0].key
                            if (coverKey) {
                                item.coverUrl = await this.utilitiesService.createS3SignedUrl(coverKey)
                            }
                        }
                    }

                    return {
                        holding_num: parseFloat(item?.holdingNum || 0),
                        formated_holding_num: UtilitiesService.formatBigNumber(item?.holdingNum || 0),
                        holding_amount: parseFloat(parseFloat(item?.holdingAmount || 0).toFixed(2)),
                        formated_holding_amount: UtilitiesService.formatBigNumber(item?.holdingAmount || 0),
                        price: parseFloat(item?.price || 0),
                        formated_price: UtilitiesService.formatBigNumber(item?.price || 0),
                        symbol: item?.symbol || "",
                        mint: item?.mint || "",
                        name: item?.name || "",
                        cover_url: item?.coverUrl || "",
                        change5m: item?.change5m || "",
                        change1h: item?.change1h || "",
                        change24h: item?.change24h || "",
                    }
                }),
            ),
            page: parseInt(data?.page),
            page_size: parseInt(data?.pageSize),
        }
        await this.cacheManager.set(cacheKey, res, 5000) //5 seconds
        return res
    }

    async getUsdcBalance(user: UserJwtExtractDto): Promise<{ address: string; balance: number }> {
        const walletDetail = await this.getWalletBalance(user.wallet_address, GiggleService.GIGGLE_LEGAL_USDC)
        return {
            address: user.wallet_address,
            balance: Number(walletDetail[0].amount) || 0,
        }
    }

    async getUserMarketCap(user: UserJwtExtractDto): Promise<UserMarketCapDto> {
        const walletDetail = await this.getUserWalletDetail(user, 1, 100)
        return {
            ip_total_market_cap: walletDetail.ip_total_market_cap,
            formated_market_cap: walletDetail.formated_market_cap,
        }
    }

    computeCreditPrice(marketCap: number): number {
        return Math.floor(
            Math.max(this.creditPriceMin, Math.min(this.creditPriceMax, marketCap * this.creditMarketCapPercentage)),
        )
    }

    async getTotalBalanceChange24h(username_in_be: string, currentBalance: number): Promise<number> {
        const result = await this.prismaService.user_wallet_record_24h.findFirst({
            where: { user: username_in_be, created_at: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
            orderBy: { created_at: "desc" },
        })
        const record = result?.record as any as WalletDetailDto
        const balanceBefore = record?.total_balance || 0

        if (balanceBefore === 0) {
            return 0
        }

        const balanceChange = ((currentBalance - balanceBefore) / balanceBefore) * 100
        return parseFloat(balanceChange.toFixed(2) || "0")
    }

    //trade ip token
    async trade(user: UserJwtExtractDto, body: TradeDto) {
        const { type, token, amount } = body
        if (amount <= 0) {
            throw new BadRequestException("Amount must be greater than 0")
        }

        const userEmail = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })
        if (!userEmail) {
            throw new BadRequestException("User email not found")
        }

        const signatureParams = this.generateSignature({
            token: token,
            type: type,
            isUsdc: false,
            amount: amount,
            email: userEmail.email,
        })
        const response: AxiosResponse<GiggleApiResponseDto<TradeResponseFromGiggleDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/trade", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )

        await this.prismaService.ip_token_trade_record.create({
            data: {
                token: token,
                type: type,
                amount: new Prisma.Decimal(amount),
                user: userEmail.username_in_be,
                status: response.data.data.status,
                response: response.data.data as any,
                request: signatureParams,
            },
        })

        if (response.data.code !== 0 || response.data.data.status === TradeStatus.FAILED) {
            this.logger.error(
                `Failed to trade: ${response.data.msg}, user: ${userEmail.email}, request: ${JSON.stringify(signatureParams)}`,
            )
            throw new BadRequestException("Failed to trade: " + response.data.msg)
        }

        return {
            ...response.data.data,
            status: response.data.data.status,
            sign: response.data.data.sign,
        }
    }

    //swap usdc to sol
    async swapUsdcToSol(user: UserJwtExtractDto, amount: number): Promise<SwapUsdcToSolResponseDto> {
        const userEmail = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })
        if (!userEmail) {
            throw new BadRequestException("User email not found")
        }

        const signatureParams = this.generateSignature({
            amount: amount,
            email: userEmail.email,
        })

        const response: AxiosResponse<GiggleApiResponseDto<SwapUsdcToSolResponseDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/swap", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )

        if (response.data.code !== 0) {
            throw new BadRequestException("Failed to swap usdc to sol: " + response.data.msg)
        }

        return response.data.data
    }

    async sendToken(user: UserJwtExtractDto, body: SendTokenDto, payer?: string): Promise<SendTokenResponseDto> {
        if (body.amount <= 0) {
            throw new BadRequestException("Amount must be greater than 0")
        }
        const userEmail = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })
        if (!userEmail) {
            throw new BadRequestException("User email not found")
        }
        const { mint, amount, receipt } = body
        const params: any = {
            amount: amount,
            receipt: receipt,
            email: userEmail.email,
        }

        if (mint) {
            params.mint = mint
        }

        if (payer) {
            delete params.email
            params.address = payer
        }
        const signatureParams = this.generateSignature(params)
        const response: AxiosResponse<GiggleApiResponseDto<SendTokenResponseDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/send", signatureParams, {
                headers: { "Content-Type": "application/json" },
                timeout: this.requestTimeout,
            }),
        )

        await this.prismaService.token_send_history.create({
            data: {
                mint: mint,
                amount: new Prisma.Decimal(amount),
                receipt: receipt,
                user: userEmail.username_in_be,
                response: response.data.data as any,
                request: signatureParams,
            },
        })

        if (response.data.code !== 0) {
            throw new BadRequestException(
                "Failed to send token, request: " +
                    JSON.stringify(signatureParams) +
                    ", response: " +
                    JSON.stringify(response.data),
            )
        }

        return {
            sig: response.data.data.sig,
        }
    }

    async payment(params: PaymentDto): Promise<PaymentResponseDto> {
        const userInfo = await this.prismaService.users.findUnique({
            where: { username_in_be: params.user },
        })
        if (!userInfo) {
            throw new BadRequestException("User not found")
        }

        if (params.amount <= 0) {
            throw new BadRequestException("Amount must be greater than 0")
        }

        const signatureParams = this.generateSignature({
            amount: Number(params.amount.toFixed(6)),
            mint: GiggleService.GIGGLE_LEGAL_USDC,
            email: userInfo.email,
        })

        const response: AxiosResponse<GiggleApiResponseDto<PaymentResponseDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/payment", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            throw new BadRequestException(
                "Failed to payment: " + response.data.msg + ". request:" + JSON.stringify(signatureParams),
            )
        }

        const responseData = response.data.data

        await this.prismaService.web3_orders.create({
            data: {
                sn: responseData.sn,
                user: userInfo.username_in_be,
                amount: new Prisma.Decimal(responseData?.amount),
                mint: GiggleService.GIGGLE_LEGAL_USDC,
                status: responseData?.status,
                payment_hash: responseData?.paymentHash,
                refund_hash: responseData?.refundHash,
                request: signatureParams,
                response: responseData as any,
            },
        })

        return responseData
    }

    async signTx(tx: string, signers: string[], email?: string): Promise<string> {
        let signatureParams: any = {
            base64Tx: tx,
            singers: signers,
        }
        if (email) {
            signatureParams.email = email
        }

        signatureParams = this.generateSignature(signatureParams)

        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/signAndSendTx", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (!response.data?.data?.sig) {
            this.logger.error("request sign tx signature: " + JSON.stringify(signatureParams))
            this.logger.error("response sign tx signature: " + JSON.stringify(response.data))
        } else {
            this.logger.log("request sign tx signature: " + JSON.stringify(signatureParams))
            this.logger.log("response sign tx signature: " + JSON.stringify(response.data))
        }
        return response.data.data.sig
    }

    async signTxAndThrowError(tx: string, signers: string[], email?: string): Promise<string> {
        let signatureParams: any = {
            base64Tx: tx,
            singers: signers,
        }
        if (email) {
            signatureParams.email = email
        }

        signatureParams = this.generateSignature(signatureParams)

        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/signAndSendTx", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (!response.data?.data?.sig) {
            throw new BadRequestException(`Failed to sign tx: ${JSON.stringify(response.data)}`)
        }
        return response.data.data.sig
    }

    async paymentCallback(params: PaymentCallbackDto): Promise<PaymentResponseDto> {
        const prismaService = new PrismaService()
        const order = await prismaService.web3_orders.findFirst({
            where: { sn: params.sn },
        })
        if (!order || !order.sn) {
            return
        }

        if (params.status !== ConfirmStatus.CONFIRMED && params.status !== ConfirmStatus.REFUNDED) {
            this.logger.error(
                "Invalid payment callback status: " +
                    params.status +
                    " for order: " +
                    order.sn +
                    " params: " +
                    JSON.stringify(params),
            )
            throw new BadRequestException("Invalid status")
        }

        const requestParams = this.generateSignature({
            sn: order.sn,
            status: params.status,
        })
        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/payment/confirm", requestParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )

        if (response.data.code !== 0) {
            this.logger.error("Failed to confirm payment: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to confirm payment: " + response.data.msg)
        }

        const queryParams = this.generateSignature({
            sn: order.sn,
        })
        const newOrderStatus: AxiosResponse<GiggleApiResponseDto<PaymentResponseDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/payment/query", queryParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )

        if (newOrderStatus.data.code !== 0) {
            this.logger.error("Failed to query payment: " + JSON.stringify(newOrderStatus.data))
            throw new BadRequestException("Failed to query payment: " + newOrderStatus.data.msg)
        }

        const newOrderStatusData = newOrderStatus.data.data

        await this.prismaService.web3_orders.updateMany({
            where: { sn: params.sn },
            data: {
                status: newOrderStatusData.status,
                payment_hash: newOrderStatusData.paymentHash,
                refund_hash: newOrderStatusData.refundHash,
            },
        })
        return newOrderStatusData
    }

    async bindGiggleWallet(email: string) {
        const signatureParams = this.generateSignature({
            email: email,
        })
        const response: AxiosResponse<GiggleApiResponseDto<{ email: string; addr: string }>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/user/binding", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error(
                "Failed to bind giggle wallet for user: " +
                    email +
                    ", request: " +
                    JSON.stringify(signatureParams) +
                    ", response: " +
                    JSON.stringify(response.data),
            )
            return
        }

        //update user wallet address
        await this.prismaService.users.update({
            where: { email: email },
            data: { wallet_address: response.data.data.addr },
        })
        return response.data.data
    }

    async topUp(user: UserJwtExtractDto): Promise<TopUpResponseDto> {
        const userInfo = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })
        if (!userInfo) {
            throw new BadRequestException("User not found")
        }
        const params = this.generateSignature({
            email: userInfo.email,
            opType: "buy",
        })
        const response: AxiosResponse<GiggleApiResponseDto<TopUpResponseDto>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/createRampSession", params, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error("Failed to create ramp session: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to create ramp session: " + response.data.msg)
        }
        return response.data.data
    }

    async createOnrampSession(user: UserJwtExtractDto): Promise<any> {
        const userInfo = await this.prismaService.users.findUnique({
            where: { username_in_be: user.usernameShorted },
        })
        if (!userInfo) {
            throw new BadRequestException("User not found")
        }
        const signatureParams = this.generateSignature({
            email: userInfo.email,
        })
        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/createOnRampSession", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error("Failed to create ramp session: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to create ramp session: " + response.data.msg)
        }
        return response.data.data
    }

    //get unused giggle address
    async getGiggleAddress(limit: number = 1): Promise<string[]> {
        const signatureParams = this.generateSignature({
            limit: limit,
        })
        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/getUnUsedGiggleAddr", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error("Failed to get giggle address: " + JSON.stringify(response.data))
            throw new BadRequestException("Failed to get giggle address: " + response.data.msg)
        }
        return response.data.data
    }

    //mark giggle address as used
    async markGiggleAddressUsed(address: string, used: boolean) {
        const signatureParams = this.generateSignature({
            address: address,
            used: used,
        })
        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(this.endpoint + "/cus/confirmGiggleAddr", signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error("Failed to mark giggle address as used: " + JSON.stringify(response.data))
            return false
        }
        return true
    }

    //get token price
    async getTokenPrice(mint: string): Promise<Decimal> {
        //find if token is a static token
        const staticTokens = STATIC_TOKENS.filter((token) => token.env === process.env.ENV)
        const staticToken = staticTokens.find((token) => token.new_info.token_info?.mint === mint)

        if (staticToken) {
            return new Decimal(staticToken.new_info.token_info.price)
        }

        //find if token is a static token
        const ipInfo = await this.prismaService.ip_library.findFirst({
            where: {
                token_mint: mint,
            },
        })

        if (ipInfo && (ipInfo.current_token_info as any)?.is_static_token) {
            return new Decimal((ipInfo.current_token_info as any)?.price || "0")
        }

        const unitPriceResponse = await this.getIpTokenList({
            mint: mint,
            page: "1",
            page_size: "1",
            site: "3body",
        })

        if (
            !unitPriceResponse ||
            !unitPriceResponse.data ||
            !unitPriceResponse.data.length ||
            !unitPriceResponse.data?.[0]?.price
        ) {
            this.logger.warn(`Unit price not found for token:${mint}`)
            return new Decimal(0)
            //throw new Error(`Unit price not found for token:${mint}`)
        }
        return new Decimal(unitPriceResponse.data[0].price)
    }

    @Cron(CronExpression.EVERY_DAY_AT_5AM) //est time
    //@Cron(CronExpression.EVERY_5_MINUTES) //test
    async processUserWalletRecord24h() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        this.logger.log("start processUserWalletRecord24h")
        const prismaService = new PrismaService()
        const batchSize = 10
        const total = await prismaService.users.count({
            where: {
                is_blocked: false,
            },
        })
        let record = 0
        for (let i = 0; i < total; i += batchSize) {
            const users = await prismaService.users.findMany({
                where: {
                    is_blocked: false,
                },
                skip: i,
                take: batchSize,
            })
            for (const user of users) {
                const walletDetail = await this.getUserWalletDetail(
                    { user_id: user.username_in_be, usernameShorted: user.username_in_be },
                    1,
                    100,
                )
                if (walletDetail.total_balance === 0) {
                    continue
                }
                await this.prismaService.user_wallet_record_24h.create({
                    data: {
                        user: user.username_in_be,
                        record: walletDetail as any,
                        date: new Date(),
                    },
                })
                if (walletDetail?.addr) {
                    await this.prismaService.users.update({
                        where: { username_in_be: user.username_in_be },
                        data: { wallet_address: walletDetail?.addr },
                    })
                }
                record++
            }
            await new Promise((resolve) => setTimeout(resolve, 1000)) //1 second
        }
        this.logger.log(`end processUserWalletRecord24h, processed ${record} users`)
    }

    @Cron(CronExpression.EVERY_5_MINUTES)
    async fetchNewestTokenInfo() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        //update static tokens
        const staticTokens = STATIC_TOKENS.filter((token) => token.env === process.env.ENV).filter(
            (token) => token.new_info.fetch_from_giggle === false,
        )
        let staticIps = staticTokens.map((token) => token.ip_id)
        if (staticIps.length > 0) {
            for (const token of staticTokens) {
                //update static tokens
                await this.prismaService.ip_library.update({
                    where: {
                        id: token.ip_id,
                    },
                    data: {
                        token_mint: token.new_info.token_info.mint,
                        token_info: token.new_info.token_info,
                        current_token_info: token.new_info.current_token_info,
                    },
                })
                //create reward pool
                await this.rewardsPoolService.createRewardsPool(token.ip_id)
            }
        } else {
            this.logger.log("No static tokens found")
        }

        this.logger.log("Fetching newest token info from Giggle API")
        const batchSize = 10
        const tokenCount = await this.prismaService.ip_library.count({
            where: {
                token_info: {
                    not: null,
                },
                id: { notIn: staticIps },
            },
        })
        this.logger.log(`total token count: ${tokenCount}`)
        const batchCount = Math.ceil(tokenCount / batchSize)

        for (let i = 0; i < batchCount; i++) {
            try {
                const ips = await this.prismaService.ip_library.findMany({
                    where: {
                        token_info: {
                            not: null,
                        },
                        id: { notIn: staticIps },
                    },
                    skip: i * batchSize,
                    take: batchSize,
                })
                const mints = ips
                    .map((ip) => {
                        const tokenInfo = ip.token_info as any as CreateIpTokenGiggleResponseDto
                        return tokenInfo.mint || ""
                    })
                    .filter((mint) => mint !== "")
                const listResult: any = await this.getIpTokenList({
                    mint: mints.join(","),
                    page: "1",
                    page_size: "10",
                    site: "3body",
                })
                const data = listResult.data
                for (const item of data) {
                    await this.prismaService.ip_library.updateMany({
                        where: {
                            id: { notIn: staticIps },
                            token_info: {
                                path: "$.mint",
                                equals: item.mint,
                            },
                        },
                        data: {
                            current_token_info: {
                                ...item,
                                file_url: item?.fileUrl,
                                cover_url: item?.coverUrl,
                                market_cap: item?.marketCap,
                                poolAddress: item?.poolAddress,
                                on_exchange: item?.on_exchange || false,
                                change1h: item?.change1h || "0",
                                change5m: item?.change5m || "0",
                                change24h: item?.change24h || "0",
                                price: item?.price,
                                visitLink: item?.tradingUri,
                            },
                        },
                    })
                    await this.prismaService.asset_to_meme_record.updateMany({
                        where: {
                            id: { notIn: staticIps },
                            token_info: {
                                path: "$.mint",
                                equals: item.mint,
                            },
                        },
                        data: {
                            current_token_info: {
                                ...item,
                                market_cap: item?.marketCap,
                                change1h: item?.change1h || "0",
                                change5m: item?.change5m || "0",
                                change24h: item?.change24h || "0",
                                on_exchange: item?.on_exchange || false,
                                price: item?.price,
                                visitLink: item?.tradingUri,
                                poolAddress: item?.poolAddress,
                            },
                        },
                    })

                    //update rewards pool price
                    await this.prismaService.reward_pools.updateMany({
                        where: {
                            id: { notIn: staticIps },
                            token: item.mint,
                        },
                        data: {
                            unit_price: new Prisma.Decimal(item.price),
                        },
                    })
                }
            } catch (error) {
                this.logger.error("Error fetching token info from Giggle API", error)
                continue
            }
        }
    }

    async toggleIpVisibility(ip_id: number, is_public: boolean) {
        const ip = await this.prismaService.ip_library.findUnique({
            where: { id: ip_id },
        })
        const mint = (ip?.token_info as any as CreateIpTokenGiggleResponseDto)?.mint || ""
        if (!mint) {
            return
        }

        const signatureParams = this.generateSignature({
            mint: mint,
        })

        let url = this.endpoint + "/cus/mint/del"
        if (is_public) {
            url = this.endpoint + "/cus/mint/recover"
        }
        const response: AxiosResponse<GiggleApiResponseDto<any>> = await lastValueFrom(
            this.web3HttpService.post(url, signatureParams, {
                headers: { "Content-Type": "application/json" },
            }),
        )
        if (response.data.code !== 0) {
            this.logger.error("Failed to toggle ip visibility: " + JSON.stringify(response.data))
        } else {
            this.logger.log("Successfully toggled ip visibility: " + ip_id + " to " + is_public)
        }
        return
    }

    //check if user has no wallet_address, if so, bind it
    @Cron(CronExpression.EVERY_5_MINUTES)
    async checkUserWalletAddress() {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        const users = await this.prismaService.users.findMany()
        for (const user of users) {
            if (!user.wallet_address) {
                await this.bindGiggleWallet(user.email)
            }
        }
    }
}
