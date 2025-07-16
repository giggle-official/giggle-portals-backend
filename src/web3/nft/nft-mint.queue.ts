import { Processor, WorkerHost } from "@nestjs/bullmq"
import { Job } from "bullmq"
import { PrismaService } from "src/common/prisma.service"
import { BadRequestException, Logger } from "@nestjs/common"
import { NftMintJobDataDto, NftMintMiddlewareResDto } from "./nft.dto"
import { AssetsService } from "src/assets/assets.service"
import { PinataSDK } from "pinata-web3"
import { assets } from "@prisma/client"
import { GiggleService } from "../giggle/giggle.service"
import axios, { AxiosResponse } from "axios"
import { lastValueFrom } from "rxjs"
import { HttpService } from "@nestjs/axios"
import https from "https"
import { ConfirmStatus } from "../giggle/giggle.dto"

@Processor("nft-mint-queue")
export class NftMintQueue extends WorkerHost {
    private readonly logger = new Logger(NftMintQueue.name)
    private readonly pinata = new PinataSDK({
        pinataJwt: process.env.PINATA_JWT,
        pinataGateway: process.env.PINATA_GATEWAY,
    })
    private readonly settleWallet: string
    private readonly mintNftToken: string
    private readonly mintNftEndpoint: string
    private readonly mintNftHttpService: HttpService

    constructor(
        private readonly prismaService: PrismaService,
        private readonly assetsService: AssetsService,
        private readonly giggleService: GiggleService,
    ) {
        super()
        this.settleWallet = process.env.SETTLEMENT_WALLET
        this.mintNftToken = process.env.NFT_MINT_TOKEN
        this.mintNftEndpoint = process.env.NFT_MINT_ENDPOINT
        this.mintNftHttpService = new HttpService(
            axios.create({
                httpsAgent: new https.Agent({ keepAlive: false }),
                timeout: 180000, //180s
            }),
        )
    }

    async process(job: Job<NftMintJobDataDto, null, string>): Promise<null> {
        let paymentSn: string | null = null
        try {
            const jobData = job.data
            const mint = await this.prismaService.user_nfts.findUnique({
                where: { mint_task_id: job.id },
            })
            if (!mint?.web3_order_sn) {
                //payment
                const web3order = await this.giggleService.payment({
                    user: job.data.user,
                    amount: 6,
                })
                await this.prismaService.user_nfts.update({
                    where: { mint_task_id: job.id },
                    data: {
                        web3_order_sn: web3order.sn,
                    },
                })
                paymentSn = web3order.sn
            } else {
                paymentSn = mint.web3_order_sn
            }

            //update nft status to minting
            await this.prismaService.user_nfts.update({
                where: { mint_task_id: job.id },
                data: {
                    status: "minting",
                },
            })

            //upload asset to ipfs
            const coverAsset = await this.prismaService.assets.findUnique({
                where: { asset_id: jobData.cover_asset_id },
            })
            if (!coverAsset?.ipfs_key) {
                //upload cover asset to ipfs
                coverAsset.ipfs_key = await this.assetsService.uploadAssetToIpfs(coverAsset.path, coverAsset.asset_id)
            }

            let videoAsset: assets | null = null
            if (jobData.video_asset_id) {
                videoAsset = await this.prismaService.assets.findUnique({
                    where: { asset_id: jobData.video_asset_id },
                })
                if (!videoAsset?.ipfs_key) {
                    //upload video asset to ipfs
                    videoAsset.ipfs_key = await this.assetsService.uploadAssetToIpfs(
                        videoAsset.path,
                        videoAsset.asset_id,
                    )
                }
            }
            //get user wallet address
            const userDetail = await this.prismaService.users.findUnique({
                where: { username_in_be: jobData.user },
            })
            if (!userDetail?.wallet_address) {
                throw new Error("User wallet address not found")
            }

            //generate metadata
            const metadata = await this.generateMetadata(coverAsset, videoAsset, jobData.name, jobData.description)

            //update metadata to ipfs
            const metadataIpfsKey = await this.pinata.upload.json(metadata)
            const metadataUrl = process.env.PINATA_GATEWAY + "/ipfs/" + metadataIpfsKey.IpfsHash

            //mint collection if not exists
            if (!jobData.collection) {
                const collectionAddress = await this.mintCollection(
                    jobData.name,
                    userDetail.wallet_address,
                    metadataUrl,
                    userDetail.email,
                )

                //update collection address to db
                await this.prismaService.users.update({
                    where: { username_in_be: userDetail.username_in_be },
                    data: {
                        collection: collectionAddress,
                    },
                })
                jobData.collection = collectionAddress
            }

            //mint nft
            const mintDetail = await this.mintNftOnChain(
                jobData.name,
                userDetail.wallet_address,
                metadataUrl,
                userDetail.email,
                jobData.collection,
                job.id,
            )

            //update nft address to db

            await this.prismaService.user_nfts.update({
                where: { mint_task_id: job.id },
                data: {
                    collection: jobData.collection,
                    mint: mintDetail.nftAddress,
                    metadata: metadata,
                    metadata_uri: metadataUrl,
                    status: "success",
                },
            })

            //payment callback
            await this.giggleService.paymentCallback({
                sn: paymentSn,
                status: ConfirmStatus.CONFIRMED,
            })

            return null
        } catch (error) {
            this.logger.error(`Error minting nft: ${error}`)
            //update nft status to failed
            await this.prismaService.user_nfts.updateMany({
                where: { mint_task_id: job.id },
                data: {
                    status: "failed",
                    failure_reason: error.message || "Unknown error",
                },
            })
            //refund payment
            if (paymentSn) {
                await this.giggleService.paymentCallback({
                    sn: paymentSn,
                    status: ConfirmStatus.REFUNDED,
                })
            }
            return null
        }
    }

    async generateMetadata(coverAsset: assets, videoAsset: assets | null, name: string, description: string) {
        const pinataGateway = process.env.PINATA_GATEWAY

        if (!videoAsset) {
            const imageUrl = pinataGateway + "/ipfs/" + coverAsset.ipfs_key
            return {
                name: name,
                description: description,
                image: imageUrl,
                properties: {
                    files: [
                        {
                            uri: imageUrl,
                            type: (coverAsset.head_object as Record<string, any>)?.ContentType as string,
                        },
                    ],
                    category: "image",
                },
            }
        } else {
            const imageUrl = pinataGateway + "/ipfs/" + coverAsset.ipfs_key
            const videoUrl = pinataGateway + "/ipfs/" + videoAsset.ipfs_key
            return {
                name: name,
                image: imageUrl,
                animation_url: videoUrl,
                description: description,
                properties: {
                    files: [
                        {
                            uri: imageUrl,
                            type: (coverAsset.head_object as Record<string, any>)?.ContentType as string,
                        },
                        {
                            uri: videoUrl,
                            type: (videoAsset.head_object as Record<string, any>)?.ContentType as string,
                        },
                    ],
                    category: "video",
                },
            }
        }
    }

    async mintCollection(
        name: string,
        creatorAddress: string,
        metadataUri: string,
        creatorEmail: string,
    ): Promise<string> {
        //get collection address
        const address = await this.giggleService.getGiggleAddress(1)
        if (!address?.[0]) {
            throw new Error("Failed to get giggle address")
        }
        const collectionAddress = address[0]
        try {
            //mint collection
            const mintParams = {
                creator: creatorAddress,
                name: name,
                collection: collectionAddress,
                uri: metadataUri,
                fee: "0",
                payer: this.settleWallet,
                __authToken: this.mintNftToken,
            }

            const func = "/Register"

            const response: AxiosResponse<NftMintMiddlewareResDto> = await lastValueFrom(
                this.mintNftHttpService.post(this.mintNftEndpoint + func, mintParams, {
                    headers: { "Content-Type": "application/json" },
                }),
            )
            if (!response.data?.isSucc) {
                throw new Error("Failed to mint collection: " + response.data)
            }

            //sign tx
            const tx = response.data.res.tx
            const signers = [collectionAddress, this.settleWallet]
            const signature = await this.giggleService.signTx(tx, signers, creatorEmail)
            if (!signature) {
                throw new BadRequestException("Sign tx failed")
            }

            //mark collection address is used
            const isMarked = await this.giggleService.markGiggleAddressUsed(collectionAddress, true)
            if (!isMarked) {
                throw new Error("Failed to mark giggle address as used")
            }
            return collectionAddress
        } catch (error) {
            await this.giggleService.markGiggleAddressUsed(collectionAddress, false)
            this.logger.error(`Error minting collection: ${error}`)
            throw new Error("Failed to mint collection: " + error.message)
        }
    }

    async mintNftOnChain(
        name: string,
        creatorAddress: string,
        metadataUri: string,
        creatorEmail: string,
        collectionAddress: string,
        taskId: string,
    ): Promise<{ nftAddress: string; mintResponse: any; mintRequest: any }> {
        //get nft address
        const address = await this.giggleService.getGiggleAddress(1)
        if (!address?.[0]) {
            throw new Error("Failed to get giggle address")
        }
        const nftAddress = address[0]
        this.logger.log(`obtained nft address: ${nftAddress}`)

        try {
            //mint nft
            const mintParams = {
                creator: creatorAddress,
                name: name,
                collection: collectionAddress,
                asset: nftAddress,
                uri: metadataUri,
                // fee: (6 * 10 ** 6).toString(), //6 usdc
                fee: "0",
                payer: this.settleWallet,
                __authToken: this.mintNftToken,
            }

            const func = "/MintNFT"

            //update request to db
            await this.prismaService.user_nfts.update({
                where: { mint_task_id: taskId },
                data: {
                    mint_request: mintParams,
                },
            })
            const response: AxiosResponse<NftMintMiddlewareResDto> = await lastValueFrom(
                this.mintNftHttpService.post(this.mintNftEndpoint + func, mintParams, {
                    headers: { "Content-Type": "application/json" },
                }),
            )

            //update response to db
            await this.prismaService.user_nfts.update({
                where: { mint_task_id: taskId },
                data: {
                    mint_response: response.data as any,
                },
            })

            if (!response.data?.isSucc) {
                throw new Error("Failed to mint nft: " + response.data)
            }

            //sign tx
            const tx = response.data.res.tx
            const signers = [nftAddress, this.settleWallet]
            const signature = await this.giggleService.signTx(tx, signers, creatorEmail)
            if (!signature) {
                throw new Error("Failed to sign tx when minting nft: " + tx)
            }

            const isMarked = await this.giggleService.markGiggleAddressUsed(nftAddress, true)
            if (!isMarked) {
                throw new Error("Failed to mark giggle address as used when minting nft: " + nftAddress)
            }

            //update signature to db
            await this.prismaService.user_nfts.update({
                where: { mint_task_id: taskId },
                data: {
                    signature: signature,
                },
            })

            return { nftAddress, mintResponse: response.data, mintRequest: mintParams }
        } catch (error) {
            await this.giggleService.markGiggleAddressUsed(nftAddress, false)
            this.logger.error(`Error minting nft: ${error}`)
            throw new Error("Failed to mint nft: " + error.message)
        }
    }
}
