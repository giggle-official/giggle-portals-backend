import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserInfoDTO } from "src/user/user.controller"
import {
    AssetsListResDto,
    AssetListReqDto,
    AssetRenameReqDto,
    AssetsDto,
    UploadTokenDto,
    UploadTokenResDto,
    UploadedDto,
    AssetCreateDto,
    AssetDetailDto,
    ASSETS_MAX_TAKE,
    UploadedByTaskDto,
    RelateToIpDto,
    EditVideoAssetDto,
} from "./assets.dto"
import { Prisma } from "@prisma/client"
import { UtilitiesService } from "src/common/utilities.service"
import { v4 } from "uuid"
import {
    NewImageProcessResult,
    NewVideoProcessResult,
    TaskQueryResponseDto,
    TaskQueryResponseResult,
    VideoInfoTaskResponseDto,
    VideoSplitDto,
} from "src/task/task.dto"
import { TaskService } from "src/task/task.service"
import sharp from "sharp"
import { IpLibraryService } from "src/ip-library/ip-library.service"

@Injectable()
export class AssetsService {
    private readonly logger = new Logger(AssetsService.name)
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,

        @Inject(forwardRef(() => TaskService))
        private readonly taskService: TaskService,

        @Inject(forwardRef(() => IpLibraryService))
        private readonly ipLibraryService: IpLibraryService,
    ) {}
    async getAssets(user: UserInfoDTO, query: AssetListReqDto): Promise<AssetsListResDto> {
        const where: Prisma.assetsWhereInput = {
            user: user.usernameShorted,
            type: "video",
        }
        if (query.type && query.type !== "all") where.type = query.type
        if (query.category) where.category = query.category
        if (query.take > ASSETS_MAX_TAKE) query.take = ASSETS_MAX_TAKE
        if (query.exported_by) where.exported_by = query.exported_by
        if (query.source_video) where.source_video = query.source_video

        const assets = await this.prismaService.assets.findMany({
            where,
            skip: parseInt(query.skip.toString() || "0"),
            take: parseInt(query.take.toString()),
            select: {
                id: true,
                name: true,
                type: true,
                category: true,
                path: true,
                path_optimized: true,
                created_at: true,
                thumbnail: true,
                exported_by: true,
                source_video: true,
                asset_info: true,
            },
            orderBy: {
                created_at: "desc",
            },
        })

        const total = await this.prismaService.assets.count({ where })
        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)

        const data = await Promise.all(
            assets.map(async (asset) => ({
                ...asset,
                signed_url: await this.utilitiesService.createS3SignedUrl(asset.path, s3Info),
                download_url: await this.utilitiesService.createS3SignedUrl(asset.path, s3Info, true),
                thumbnail: asset.thumbnail
                    ? await this.utilitiesService.createS3SignedUrl(asset.thumbnail, s3Info)
                    : null,
            })),
        )

        return {
            data,
            total,
        }
    }

    async renameAsset(user: UserInfoDTO, body: AssetRenameReqDto): Promise<AssetDetailDto> {
        const asset = await this.prismaService.assets.findUnique({ where: { id: body.id, user: user.usernameShorted } })
        if (!asset) throw new NotFoundException("Asset not found")

        const result = await this.prismaService.assets.update({
            where: { id: body.id },
            data: { name: body.name },
        })
        return await this.getAsset(user, result.id)
    }

    async getAsset(user: UserInfoDTO, id: number): Promise<AssetDetailDto> {
        const asset = await this.prismaService.assets.findUnique({
            where: { id, user: user.usernameShorted },
            include: {
                asset_related_ips: {
                    include: {
                        ip: true,
                    },
                },
            },
        })
        if (!asset) throw new NotFoundException("Asset not found")
        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)
        const optimizedUrls: { [key: string]: string } = {}
        if (asset.path_optimized && asset.path_optimized !== null) {
            Object.keys(asset.path_optimized).forEach(async (key) => {
                optimizedUrls[key] = await this.utilitiesService.createS3SignedUrl(
                    asset.path_optimized[key] as string,
                    s3Info,
                )
            })
        }

        const ip_library_ids = asset.asset_related_ips.map((item) => item.ip_id)

        //remove duplicate ip_library_ids
        delete asset.asset_related_ips

        return {
            ...asset,
            optimized_urls: optimizedUrls,
            signed_url: await this.utilitiesService.createS3SignedUrl(asset.path, s3Info),
            download_url: await this.utilitiesService.createS3SignedUrl(asset.path, s3Info, true),
            thumbnail_url: asset.thumbnail
                ? await this.utilitiesService.createS3SignedUrl(asset.thumbnail, s3Info)
                : null,
            related_ip_libraries:
                (await Promise.all(
                    ip_library_ids.map((item) => this.ipLibraryService.detail(item.toString(), null)),
                )) || [],
        }
    }

    async deleteAsset(user: UserInfoDTO, id: number): Promise<AssetsDto> {
        const asset = await this.prismaService.assets.findUnique({ where: { id, user: user.usernameShorted } })
        if (!asset) throw new NotFoundException("Asset not found")
        const relatedIps = await this.prismaService.asset_related_ips.findMany({ where: { asset_id: id } })
        if (relatedIps.length > 0) {
            throw new BadRequestException("Asset is related to ip library, can not delete")
        }

        const mintedTokens = await this.prismaService.asset_to_meme_record.findMany({ where: { asset_id: id } })
        if (mintedTokens.length > 0) {
            throw new BadRequestException("Asset is minted to meme, can not delete")
        }
        return await this.prismaService.assets.delete({ where: { id } })
    }

    async uploadToken(userInfo: UserInfoDTO, body: UploadTokenDto): Promise<UploadTokenResDto> {
        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
        const s3Client = await this.utilitiesService.getS3Client(userInfo.usernameShorted)
        const object_key = await this.getAssetKey(userInfo, body.file_name)

        const params = {
            Bucket: s3Info.s3_bucket,
            Key: object_key,
            ContentType: body.file_type,
            Expires: 86400 * 7,
        }

        try {
            const signed_url = await s3Client.getSignedUrlPromise("putObject", params)
            return { object_key, signed_url }
        } catch (error) {
            this.logger.error("Error generating signed URL:", error)
            throw new InternalServerErrorException("Failed to generate upload URL")
        }
    }

    async uploadedByTask(userInfo: UserInfoDTO, body: UploadedByTaskDto): Promise<AssetsDto> {
        const asset = await this.prismaService.assets.findFirst({
            where: { exported_by_task_id: body.task_id, path: body.object_key },
        })

        if (asset) {
            this.logger.warn(`Asset ${asset.id} already exists for task ${body.task_id}, ignore uploading`)
            return this.getAsset(userInfo, asset.id)
        }
        return this.uploaded(userInfo, body)
    }

    async uploaded(userInfo: UserInfoDTO, body: UploadedDto | UploadedByTaskDto): Promise<AssetsDto> {
        try {
            const s3Client = await this.utilitiesService.getS3Client(userInfo.usernameShorted)
            const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

            try {
                await s3Client
                    .headObject({
                        Bucket: s3Info.s3_bucket,
                        Key: body.object_key,
                    })
                    .promise()
            } catch (error) {
                this.logger.error("Error checking file in S3:", JSON.stringify(error))
                if (error.code === "NotFound") {
                    throw new NotFoundException("File not found in S3")
                }
                throw new InternalServerErrorException("Error checking file in S3")
            }
            const { fileType, extension } = await this.getAssetType(body.object_key)

            if (fileType === "unknown") throw new BadRequestException("Unknown file type")

            let assetInfo: NewVideoProcessResult | NewImageProcessResult | null = null
            if (fileType === "video") {
                //convert video to mp4
                if (extension !== "mp4" && extension !== "mov" && extension !== "mkv") {
                    body.object_key = await this.convertVideoToMp4(userInfo, body.object_key)
                    body.name = body.name.replace(/\.[^/.]+$/, "")
                }
                //process video
                assetInfo = await this.processNewVideo(userInfo, body.object_key, body?.optimize || false)
            } else if (fileType === "image") {
                assetInfo = await this.processNewImage(userInfo, body.object_key)
            }
            let objectKey: string = body.object_key

            const created = await this.prismaService.$transaction(async (tx) => {
                const created = await tx.assets.create({
                    data: {
                        user: userInfo.usernameShorted,
                        name: body.name,
                        type: fileType,
                        path: objectKey,
                        path_optimized: (assetInfo as any)?.optimizedResult || null,
                        category: body?.category || "uploads",
                        thumbnail: (assetInfo as any)?.thumbnail || null,
                        asset_info: assetInfo as any,
                        source_video: body?.source_video || null,
                        exported_by: body?.exported_by || null,
                        exported_by_task_id: body instanceof UploadedByTaskDto ? body.task_id : null,
                    },
                })
                return created
            })
            return await this.getAsset(userInfo, created.id)
        } catch (error) {
            this.logger.error("Error uploading asset:", error)
            throw new InternalServerErrorException("Failed to upload asset")
        }
    }

    async relateToIp(userInfo: UserInfoDTO, body: RelateToIpDto): Promise<AssetDetailDto> {
        const ip = await this.prismaService.ip_library.findUnique({ where: { id: body.ip_id } })
        if (!ip) throw new NotFoundException("ip not found")

        const asset = await this.prismaService.assets.findUnique({
            where: { id: body.asset_id, user: userInfo.usernameShorted },
        })
        if (!asset) throw new NotFoundException("asset not found")

        const relatedIp = await this.prismaService.asset_related_ips.findFirst({
            where: { asset_id: asset.id, ip_id: ip.id },
        })
        if (!relatedIp) {
            await this.prismaService.asset_related_ips.create({
                data: { asset_id: asset.id, ip_id: ip.id },
            })
        }
        return await this.getAsset(userInfo, body.asset_id)
    }

    async clearRelatedIp(userInfo: UserInfoDTO, ipId: number): Promise<void> {
        await this.prismaService.asset_related_ips.deleteMany({ where: { ip_id: ipId } })
    }

    async processNewImage(userInfo: UserInfoDTO, objectKey: string): Promise<NewImageProcessResult> {
        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
        const s3Client = await this.utilitiesService.getS3Client(userInfo.usernameShorted)
        const image = await s3Client
            .getObject({
                Bucket: s3Info.s3_bucket,
                Key: objectKey,
            })
            .promise()
        const metadata = await sharp(image.Body as any).metadata()
        let thumbnailKey = objectKey
        if (metadata.width > 300) {
            thumbnailKey = `${objectKey.split(".")[0]}.thumb.jpg`
            const thumbnailBuffer = await sharp(image.Body as any)
                .resize({ width: 300 })
                .toBuffer()
            await s3Client
                .putObject({
                    Bucket: s3Info.s3_bucket,
                    Key: thumbnailKey,
                    Body: thumbnailBuffer,
                    ContentType: "image/jpeg",
                })
                .promise()
        }

        return {
            width: metadata?.width,
            height: metadata?.height,
            thumbnail: thumbnailKey,
        }
    }

    async createAsset(data: AssetCreateDto): Promise<AssetsDto> {
        return await this.prismaService.assets.create({
            data: {
                user: data.user,
                name: data.name,
                type: data.type,
                path: data.path,
                category: data.category,
                thumbnail: data.thumbnail,
                asset_info: data.asset_info,
                source_video: data?.source_video,
                exported_by: data?.exported_by,
            },
        })
    }

    public async processNewVideo(
        userInfo: UserInfoDTO,
        objectKey: string,
        optimize: boolean = false,
    ): Promise<NewVideoProcessResult> {
        try {
            const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
            // Create a task to retrieve video info
            const videoInfoTask = await this.taskService.taskCreateRequest({
                method: "VideoService.VideoInfo",
                params: [{ bucket: s3Info.s3_bucket, file_name: objectKey }],
                id: v4(),
            })

            // Query the task result
            let taskQueryResult: TaskQueryResponseDto<TaskQueryResponseResult>
            let retryCount = 0
            const maxRetries = 10
            const retryDelay = 500 // 0.5 seconds

            do {
                taskQueryResult = await this.taskService.taskQueryRequest({
                    method: "QueryService.Task",
                    params: [
                        {
                            task_id: videoInfoTask.result.task_id,
                            task_type: "VideoInfo",
                            user_id: userInfo.email,
                        },
                    ],
                    id: v4(),
                })

                if (taskQueryResult.result.status >= 2) {
                    break
                }

                retryCount++
                if (retryCount < maxRetries) {
                    await new Promise((resolve) => setTimeout(resolve, retryDelay))
                }
            } while (retryCount < maxRetries)

            if (retryCount === maxRetries) {
                throw new Error("Max retries reached while querying task status")
            }

            if (taskQueryResult.result.status === 3) {
                throw new Error("Video info task did not complete successfully: " + taskQueryResult.result.result)
            }

            const videoInfo = JSON.parse(taskQueryResult.result.result as string) as VideoInfoTaskResponseDto

            let newWidth: number = 0
            let newHeight: number = 0
            let optimizedResult: any = undefined

            if (optimize) {
                if (videoInfo.width > 720 || videoInfo.height > 720) {
                    const aspectRatio = videoInfo.width / videoInfo.height

                    if (aspectRatio > 1) {
                        newWidth = 720
                        newHeight = Math.floor(720 / aspectRatio)
                        if (newHeight % 2 !== 0) {
                            newHeight += 1
                        }
                    } else {
                        newHeight = 720
                        newWidth = Math.floor(720 * aspectRatio)
                        if (newWidth % 2 !== 0) {
                            newWidth += 1
                        }
                    }
                }
                const videoOptimizeTask = await this.taskService.taskCreateRequest({
                    method: "VideoService.VideoTranscode",
                    params: [
                        {
                            bucket: s3Info.s3_bucket,
                            file_name: objectKey,
                            width: newWidth,
                            height: newHeight,
                            bitrate: 300,
                        },
                    ],
                    id: v4(),
                })

                // Query the task result
                const requestInterval = 1000 // 1 second
                const timeout = 30 * 60 * 1000 // 30 minutes in milliseconds
                const startTime = Date.now()
                let optimizeTaskQueryResult: TaskQueryResponseDto<TaskQueryResponseResult>
                do {
                    optimizeTaskQueryResult = await this.taskService.taskQueryRequest({
                        method: "QueryService.Task",
                        params: [
                            {
                                task_id: videoOptimizeTask.result.task_id,
                                task_type: "VideoTranscode",
                                user_id: userInfo.email,
                            },
                        ],
                        id: v4(),
                    })

                    if (optimizeTaskQueryResult.result.status === 2) {
                        const result = optimizeTaskQueryResult?.result?.result
                        if (result) {
                            optimizedResult = { "300kbit": result }
                        }
                        break
                    }

                    if (optimizeTaskQueryResult.result.status === 3) {
                        this.logger.error(
                            "Optimize task did not complete successfully: " + optimizeTaskQueryResult.result.result,
                        )
                        break
                    }

                    if (Date.now() - startTime > timeout) {
                        this.logger.error("Timeout reached while querying optimize task status")
                        break
                    }
                    await new Promise((resolve) => setTimeout(resolve, requestInterval))
                } while (true)
            }

            return {
                videoInfo: videoInfo,
                videoInfoTaskId: videoInfoTask.result.task_id,
                thumbnail: videoInfo.thumbnail,
                optimizedResult: optimizedResult,
            }
        } catch (error) {
            this.logger.error("Error processing uploaded video:", error)
            throw new InternalServerErrorException("Failed to process uploaded video")
        }
    }

    public async convertVideoToMp4(userInfo: UserInfoDTO, objectKey: string): Promise<string> {
        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
        const videoConvertTask = await this.taskService.taskCreateRequest({
            method: "VideoService.VideoFormat",
            params: [{ bucket: s3Info.s3_bucket, file_name: objectKey }],
            id: v4(),
        })

        // Query the task result
        let taskQueryResult: TaskQueryResponseDto<TaskQueryResponseResult>
        const timeout = 30 * 60 * 1000 // 30 minutes
        const retryDelay = 500 // 0.5 seconds
        const startTime = Date.now()
        do {
            taskQueryResult = await this.taskService.taskQueryRequest({
                method: "QueryService.Task",
                params: [
                    {
                        task_id: videoConvertTask.result.task_id,
                        task_type: "VideoFormat",
                        user_id: userInfo.email,
                    },
                ],
                id: v4(),
            })

            if (taskQueryResult.result.status === 2) {
                return taskQueryResult.result.result as string
            }

            if (taskQueryResult.result.status > 2) {
                this.logger.error("Video format task did not complete successfully: " + taskQueryResult.result.result)
                throw new BadRequestException("Video convert failed")
            }

            if (Date.now() - startTime > timeout) {
                this.logger.error("Timeout reached while querying video format task status")
                throw new BadRequestException("Video convert timeout")
            }
            await new Promise((resolve) => setTimeout(resolve, retryDelay))
        } while (true)
    }

    public async getAssetKey(userInfo: UserInfoDTO, filename: string) {
        const extension = filename.split(".").pop()
        const randomString = Math.random().toString(36).substring(2, 15)
        filename = `${randomString}.${extension}`
        return `${userInfo.usernameShorted}/${filename}`
    }

    public async getAssetType(
        filename: string,
    ): Promise<{ fileType: "video" | "image" | "unknown"; extension: string }> {
        const extension = filename.split(".").pop()?.toLowerCase()
        if (extension === "mp4" || extension === "mov" || extension === "mkv") return { fileType: "video", extension }
        if (extension === "jpg" || extension === "jpeg" || extension === "png") return { fileType: "image", extension }
        return { fileType: "unknown", extension }
    }

    async getAssetSize(assetId: number): Promise<number> {
        if (!assetId) return 0
        const asset = await this.prismaService.assets.findUnique({ where: { id: assetId } })
        if (!asset) throw new NotFoundException("Asset not found")
        const videoInfo = (asset.asset_info as any)?.videoInfo as VideoInfoTaskResponseDto
        if (videoInfo?.size) return videoInfo.size

        const s3Info = await this.utilitiesService.getS3Info(asset.user)
        const s3Client = await this.utilitiesService.getS3Client(asset.user)
        const size = await s3Client.headObject({ Bucket: s3Info.s3_bucket, Key: asset.path }).promise()
        await this.prismaService.assets.update({
            where: { id: assetId },
            data: {
                asset_info: {
                    ...(asset.asset_info as any),
                    videoInfo: { ...(asset.asset_info as any).videoInfo, size: size.ContentLength },
                },
            },
        })
        return size.ContentLength
    }
}
