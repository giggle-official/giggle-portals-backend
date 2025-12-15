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
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    AssetsListResDto,
    AssetListReqDto,
    AssetRenameReqDto,
    GetPresignedUploadUrlResDto,
    AssetDetailDto,
    UploadedByTaskDto,
    RegisterAssetDto,
    GetPresignedUploadUrlReqDto,
} from "./assets.dto"
import { Prisma } from "@prisma/client"
import { TASK_IDS, UtilitiesService } from "src/common/utilities.service"
import {
    AudioInfoTaskResponseDto,
    NewAudioProcessResult,
    NewImageProcessResult,
    NewVideoProcessResult,
    VideoInfoTaskResponseDto,
} from "src/task/task.dto"
import { TaskService } from "src/task/task.service"
import sharp from "sharp"
import { UserService } from "src/user/user.service"
import * as AWS from "aws-sdk"
import * as os from "os"
import * as path from "path"
import { createReadStream } from "fs"
import * as cliProgress from "cli-progress"
import { HttpService } from "@nestjs/axios"
import { lastValueFrom } from "rxjs"
import { InjectQueue, Processor } from "@nestjs/bullmq"
import { Queue } from "bullmq"
import { PinataSDK } from "pinata-web3"

const ffmpeg = require("fluent-ffmpeg")

@Injectable()
export class AssetsService {
    private readonly logger = new Logger(AssetsService.name)
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,

        @Inject(forwardRef(() => TaskService))
        private readonly taskService: TaskService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        private readonly httpService: HttpService,

        @InjectQueue("ipfs-upload-queue")
        private readonly ipfsUploadQueue: Queue,
    ) {}

    async getAssets(user: UserJwtExtractDto, query: AssetListReqDto): Promise<AssetsListResDto> {
        const userProfile = await this.userService.getProfile(user)
        const where: Prisma.assetsWhereInput = {
            user: user.usernameShorted,
        }
        if (query.type && query.type !== "all") where.type = query.type
        if (query.object_key) where.path = query.object_key

        if (userProfile.widget_info?.widget_tag) where.widget_tag = userProfile.widget_info.widget_tag

        const assets = await this.prismaService.assets.findMany({
            where,
            skip: Math.max(0, parseInt(query.page.toString()) - 1) * Math.max(0, parseInt(query.page_size.toString())),
            take: Math.max(0, parseInt(query.page_size.toString()) || 10),
            select: {
                asset_id: true,
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
                widget_tag: true,
                app_id: true,
                head_object: true,
            },
            orderBy: {
                created_at: "desc",
            },
        })

        const total = await this.prismaService.assets.count({ where })

        return {
            data: await Promise.all(assets.map(async (asset) => this.mapAssetDetail(asset))),
            total,
        }
    }

    async renameAsset(user: UserJwtExtractDto, body: AssetRenameReqDto): Promise<AssetDetailDto> {
        const asset = await this.prismaService.assets.findUnique({
            where: { asset_id: body.asset_id, user: user.usernameShorted },
        })
        if (!asset) throw new NotFoundException("Asset not found")

        const result = await this.prismaService.assets.update({
            where: { asset_id: body.asset_id },
            data: { name: body.name },
        })
        return await this.getAsset(user, result.asset_id)
    }

    async getAsset(user: UserJwtExtractDto, asset_id: string): Promise<AssetDetailDto> {
        const asset = await this.prismaService.assets.findUnique({
            where: { asset_id, user: user.usernameShorted },
            include: {
                asset_related_ips: {
                    include: {
                        ip: true,
                    },
                },
            },
        })
        if (!asset) throw new NotFoundException("Asset not found")
        return this.mapAssetDetail(asset)
    }

    async mapAssetDetail(asset: any): Promise<AssetDetailDto> {
        const optimizedUrls: { [key: string]: string } = {}
        if (asset.path_optimized && asset.path_optimized !== null) {
            Object.keys(asset.path_optimized).forEach(async (key) => {
                optimizedUrls[key] = await this.utilitiesService.createS3SignedUrl(asset.path_optimized[key] as string)
            })
        }

        const signedUrl = await this.utilitiesService.createS3SignedUrl(asset.path)
        const downloadUrl = await this.utilitiesService.createS3SignedUrl(asset.path, true)
        const publicUrl = asset.path.startsWith("public/") ? signedUrl : ""

        return {
            asset_id: asset.asset_id,
            name: asset.name,
            type: asset.type,
            category: asset.category,
            path: asset.path,
            path_optimized: asset.path_optimized,
            created_at: asset.created_at,
            user: asset.user,
            widget_tag: asset.widget_tag,
            app_id: asset.app_id,
            source_video: asset.source_video,
            asset_info: asset.asset_info,
            thumbnail: asset.thumbnail,
            ipfs_key: asset.ipfs_key,
            head_object: asset.head_object as Record<string, any>,
            public_url: publicUrl,
            optimized_urls: optimizedUrls,
            signed_url: signedUrl,
            download_url: downloadUrl,
            thumbnail_url: await this.utilitiesService.createS3SignedUrl(asset.thumbnail),
        }
    }

    async deleteAsset(user: UserJwtExtractDto, id: number): Promise<{ success: boolean }> {
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
        await this.prismaService.assets.delete({ where: { id } })
        return { success: true }
    }

    async getPresignedUploadUrl(
        userInfo: UserJwtExtractDto,
        body: GetPresignedUploadUrlReqDto,
    ): Promise<GetPresignedUploadUrlResDto> {
        try {
            const profile = await this.userService.getProfile(userInfo)
            const widget_tag = profile.widget_info?.widget_tag || "ipos"
            const s3Info = await this.utilitiesService.getS3Info(body.is_public)
            const object_key =
                s3Info.s3_prefix + "/" + widget_tag + "/" + (await this.getAssetKey(userInfo, body.file_name))
            const s3Client = await this.utilitiesService.getS3Client(body.is_public)

            const params = {
                Bucket: s3Info.s3_bucket,
                Key: object_key,
                ContentType: body.content_type,
                Expires: 86400,
            }

            const signed_url = await s3Client.getSignedUrlPromise("putObject", params)
            return { object_key, signed_url }
        } catch (error) {
            this.logger.error("Error generating signed URL:", error)
            throw new InternalServerErrorException("Failed to generate upload URL")
        }
    }

    async registerAsset(userInfo: UserJwtExtractDto, body: RegisterAssetDto): Promise<AssetDetailDto> {
        try {
            //check path is exists
            const existingAsset = await this.prismaService.assets.findFirst({
                where: { path: body.object_key },
            })

            if (existingAsset) {
                throw new Error("this object key already registered")
            }

            let isPublic = false
            if (body.object_key.startsWith("public/")) {
                isPublic = true
            }

            const userInfoDetail = await this.userService.getProfile(userInfo)
            const s3Client = await this.utilitiesService.getS3Client(isPublic)
            const s3Info = await this.utilitiesService.getS3Info(isPublic)
            let fileInfo: AWS.S3.HeadObjectOutput | null = null

            try {
                fileInfo = await s3Client
                    .headObject({
                        Bucket: s3Info.s3_bucket,
                        Key: body.object_key,
                    })
                    .promise()
            } catch (error) {
                this.logger.error("Error checking file in S3:", JSON.stringify(error))
                if (error.code === "NotFound") {
                    throw new Error("File not found in S3")
                }
                throw new Error("Error checking file in S3")
            }

            let fileType = fileInfo?.ContentType.split("/")[0] || "unknown"
            const assetId = Math.random().toString(36).substring(2, 15)

            let assetInfo: NewVideoProcessResult | NewImageProcessResult | NewAudioProcessResult | null = null
            if (fileType === "video") {
                assetInfo = await this.processNewVideo(body.object_key, s3Client)
            } else if (fileType === "image") {
                assetInfo = await this.processNewImage(body.object_key)
            } else if (fileType === "audio") {
                assetInfo = await this.processNewAudio(body.object_key, s3Client, fileInfo)
            }

            const created = await this.prismaService.assets.create({
                data: {
                    user: userInfo.usernameShorted,
                    name: body.name,
                    head_object: fileInfo as any,
                    asset_id: assetId,
                    type: fileType,
                    app_id: userInfoDetail.widget_info?.app_id,
                    widget_tag: userInfoDetail.widget_info?.widget_tag,
                    path: body.object_key,
                    path_optimized: (assetInfo as any)?.optimizedResult || null,
                    thumbnail: (assetInfo as any)?.thumbnail || null,
                    asset_info: assetInfo as any,
                    exported_by_task_id: body instanceof UploadedByTaskDto ? body.task_id : null,
                },
            })
            //put asset to ipfs queue
            await this.ipfsUploadQueue.add(
                "uploadAssetToIpfs",
                { asset_id: created.asset_id },
                {
                    jobId: created.asset_id,
                    attempts: 3,
                },
            )
            return await this.getAsset(userInfo, created.asset_id)
        } catch (error) {
            this.logger.error("Error uploading asset:", error)
            throw new InternalServerErrorException("Failed to upload asset: " + error.message)
        }
    }

    async clearRelatedIp(ipId: number): Promise<void> {
        await this.prismaService.asset_related_ips.deleteMany({ where: { ip_id: ipId } })
    }

    async processNewImage(objectKey: string): Promise<NewImageProcessResult> {
        const s3Info = await this.utilitiesService.getS3Info(false)
        const s3Client = await this.utilitiesService.getS3Client(false)
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

    public async processNewVideo(objectKey: string, s3Client: AWS.S3): Promise<NewVideoProcessResult> {
        try {
            const s3Info = await this.utilitiesService.getS3Info(false)

            const videoStream = s3Client
                .getObject({
                    Bucket: s3Info.s3_bucket,
                    Key: objectKey,
                })
                .createReadStream()

            const metadata = await this.extractVideoMetadataFromStream(videoStream)

            const filePath = await this.generateThumbnailFromStream(objectKey)

            const thumbnailS3Key = await this.uploadThumbnailToS3(filePath, objectKey, s3Info.s3_bucket, s3Client)

            const videoInfo = metadata as VideoInfoTaskResponseDto
            let optimizedResult: any = undefined

            return {
                videoInfo: videoInfo,
                thumbnail: thumbnailS3Key,
                optimizedResult: optimizedResult,
            }
        } catch (error) {
            this.logger.error("Error processing uploaded video:", error)
            throw new InternalServerErrorException("Failed to process uploaded video")
        }
    }

    public async processNewAudio(
        objectKey: string,
        s3Client: AWS.S3,
        fileInfo: AWS.S3.HeadObjectOutput,
    ): Promise<NewAudioProcessResult> {
        try {
            const s3Info = await this.utilitiesService.getS3Info(false)

            const videoStream = s3Client
                .getObject({
                    Bucket: s3Info.s3_bucket,
                    Key: objectKey,
                })
                .createReadStream()

            const metadata = await this.extractAudioMetadataFromStream(videoStream, fileInfo)

            const audioInfo = metadata as AudioInfoTaskResponseDto

            return {
                audioInfo: audioInfo,
            }
        } catch (error) {
            this.logger.error("Error processing uploaded video:", error)
            throw new InternalServerErrorException("Failed to process uploaded video")
        }
    }

    private async extractAudioMetadataFromStream(
        stream: any,
        fileInfo: AWS.S3.HeadObjectOutput,
    ): Promise<AudioInfoTaskResponseDto> {
        try {
            const { parseStream } = await import("music-metadata")

            const metadata = await parseStream(
                stream,
                { mimeType: "audio/*", size: fileInfo.ContentLength || 0 },
                { duration: true },
            )

            if (!metadata.format) {
                throw new Error("No audio format found")
            }

            return {
                metadata: metadata,
                size: fileInfo.ContentLength || 0,
            }
        } catch (error) {
            throw new Error(`Failed to extract audio metadata: ${error.message}`)
        }
    }

    private async extractVideoMetadataFromStream(stream: any): Promise<VideoInfoTaskResponseDto> {
        return new Promise((resolve, reject) => {
            const command = ffmpeg(stream)

            command.ffprobe((err, metadata) => {
                if (err) {
                    reject(err)
                    return
                }

                const videoStream = metadata.streams.find((stream) => stream.codec_type === "video")

                if (!videoStream) {
                    reject(new Error("No video stream found"))
                    return
                }

                resolve({
                    width: videoStream.width || 0,
                    height: videoStream.height || 0,
                    duration: parseFloat(metadata.format.duration.toString()) || 0,
                })
            })
        })
    }

    private async generateThumbnailFromStream(objectKey: string): Promise<string> {
        const tempDir = os.tmpdir()

        const videoUrl = await this.utilitiesService.createS3SignedUrl(objectKey)
        const videoFile = objectKey.split("/").pop()
        const thumbnailFileName = videoFile.split(".")[0] + ".thumb.jpg"
        const writeFile = path.join(tempDir, thumbnailFileName)

        return new Promise((resolve, reject) => {
            ffmpeg(videoUrl)
                .takeScreenshots({
                    count: 1,
                    timemarks: ["00:00:00"],
                    folder: tempDir,
                    filename: thumbnailFileName,
                    size: "640x?",
                })
                .on("end", () => {
                    resolve(writeFile)
                })
                .on("error", (err: any) => {
                    this.logger.error("Error generating thumbnail:", err)
                    reject(err)
                })
        })
    }

    private async uploadThumbnailToS3(
        localThumbnailPath: string,
        originalVideoKey: string,
        bucketName: string,
        s3Client: AWS.S3,
    ): Promise<string> {
        const thumbnailKey = `${originalVideoKey.split(".")[0]}.thumb.jpg`
        const fileStream = createReadStream(localThumbnailPath)

        const uploadParams = {
            Bucket: bucketName,
            Key: thumbnailKey,
            Body: fileStream,
            ContentType: "image/jpeg",
        }

        await s3Client.upload(uploadParams).promise()
        return thumbnailKey
    }

    public async getAssetKey(userInfo: UserJwtExtractDto, filename: string) {
        const extension = filename.split(".").pop()
        const randomString = Math.random().toString(36).substring(2, 15)
        filename = `${randomString}.${extension}`
        return `${userInfo.usernameShorted}/${filename}`
    }

    async getAssetSize(assetId: string): Promise<number> {
        if (!assetId) return 0
        const asset = await this.prismaService.assets.findUnique({ where: { asset_id: assetId } })
        const headObject = asset?.head_object as Record<string, any>
        return headObject?.ContentLength || 0
    }

    async uploadAssetToIpfs(path: string, assetId: string): Promise<string> {
        //upload asset to ipfs
        const pinata = new PinataSDK({
            pinataJwt: process.env.PINATA_JWT,
            pinataGateway: process.env.PINATA_GATEWAY,
        })
        const s3Info = await this.utilitiesService.getS3Info(false)
        const s3Client = await this.utilitiesService.getS3Client(false)

        const pinataResult = await pinata.upload.stream(
            s3Client.getObject({ Bucket: s3Info.s3_bucket, Key: path }).createReadStream(),
        )

        await this.prismaService.assets.update({
            where: { asset_id: assetId },
            data: {
                ipfs_key: pinataResult.IpfsHash,
            },
        })

        return pinataResult.IpfsHash
    }

    //deprecated
    //@Cron(CronExpression.EVERY_10_MINUTES)
    async updateIpCoverImage(): Promise<void> {
        const ipLibrarys = await this.prismaService.ip_library.findMany({
            where: {
                cover_images: {
                    not: null,
                },
            },
        })
        if (!ipLibrarys) return
        for (const ip of ipLibrarys) {
            const ipCoverImage = ip.cover_images?.[0]
            if (!ipCoverImage) continue
            const asset = await this.prismaService.assets.findFirst({
                where: {
                    asset_id: (ipCoverImage?.asset_id || 0).toString(),
                },
            })
            if (!asset) continue
            if (asset.path !== ipCoverImage?.key) {
                await this.prismaService.ip_library.update({
                    where: { id: ip.id },
                    data: { cover_images: [{ ...ipCoverImage, key: asset.path, asset_id: asset.asset_id }] },
                })
            }
        }
    }

    //deprecated
    //@Cron(CronExpression.EVERY_MINUTE)
    async migrateAvatar(): Promise<void> {
        if (process.env.TASK_SLOT != "1") {
            return
        }
        const taskId = TASK_IDS.MIGRATE_AVATAR
        if (await UtilitiesService.checkTaskRunning(taskId)) {
            this.logger.log("Task is running, skipping")
            return
        }
        await UtilitiesService.startTask(taskId)

        const s3Info = await this.utilitiesService.getS3Info(true)
        const cloudFrontUrl = process.env.CLOUDFRONT_DOMAIN
        const users = await this.prismaService.users.findMany({
            where: {
                NOT: {
                    OR: [{ avatar: { startsWith: cloudFrontUrl } }],
                },
                avatar: {
                    not: null,
                },
            },
        })
        if (!users) {
            this.logger.log("No users need to migrate")
            return
        }

        const s3Client = await this.utilitiesService.getS3Client(true)

        for (const user of users) {
            this.logger.log(`Migrating avatar for user ${user.username_in_be}`)
            if (!user.avatar) continue
            const avatarContent = await lastValueFrom(
                this.httpService.get(user.avatar, {
                    responseType: "arraybuffer",
                }),
            )
            const avatarBuffer = avatarContent.data as any
            const contentType = avatarContent.headers["content-type"]

            //generate a random avatar key
            const randomString = Math.random().toString(36).substring(2, 15)
            const avatarKey = `${s3Info.s3_prefix}/ipos/${randomString}.avatar.${contentType.split("/")[1]}`

            const thumbnailBuffer = await sharp(avatarBuffer).resize({ width: 300 }).toBuffer()

            await s3Client
                .putObject({
                    Bucket: s3Info.s3_bucket,
                    Key: avatarKey,
                    Body: thumbnailBuffer,
                    ContentType: contentType,
                })
                .promise()
            const avatarUrl = await this.utilitiesService.createS3SignedUrl(avatarKey)
            await this.prismaService.users.update({
                where: { id: user.id },
                data: { avatar: avatarUrl },
            })
            this.logger.log(`✅ Migrating avatar for user ${user.username_in_be} completed`)
        }
        await UtilitiesService.stopTask(taskId)
    }

    //deprecated
    //@Cron(CronExpression.EVERY_MINUTE)
    async migrateAsset(): Promise<void> {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        const taskId = TASK_IDS.MIGRATE_ASSET
        const batchSize = 10
        if (await UtilitiesService.checkTaskRunning(taskId)) {
            this.logger.log("Task is running, skipping")
            return
        }
        await UtilitiesService.startTask(taskId)

        const assets = await this.prismaService.assets.findMany({
            where: {
                NOT: {
                    OR: [{ path: { startsWith: "public/" } }, { path: { startsWith: "private/" } }],
                },
            },
            orderBy: {
                id: "desc",
            },
        })
        if (!assets) {
            this.logger.log("No assets need to migrate")
            await UtilitiesService.stopTask(taskId)
            return
        }

        const oldS3Client = new AWS.S3({
            region: process.env.USS_REGION,
            credentials: {
                accessKeyId: process.env.USS_ACCESS_KEY,
                secretAccessKey: process.env.USS_SECRET_KEY,
            },
            s3ForcePathStyle: true,
            endpoint: process.env.USS_ENDPOINT,
        })
        const newS3Info = await this.utilitiesService.getS3Info(false)
        const newS3Client = await this.utilitiesService.getS3Client(false)

        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, i + batchSize)
            // Create a multi-progress container for this batch
            const multibar = new cliProgress.MultiBar(
                {
                    clearOnComplete: false,
                    format: "{filename} |{bar}| {percentage}% | {value}/{total} bytes",
                    barCompleteChar: "\u2588",
                    barIncompleteChar: "\u2591",
                },
                cliProgress.Presets.shades_classic,
            )

            // Create progress bars for each asset in the batch
            const progressBars = batch.map((asset) => multibar.create(100, 0, { filename: asset.path }))

            await Promise.allSettled(
                batch.map(async (asset, index) => {
                    const newKey = "private/ipos/" + asset.path
                    this.logger.log(`Migrating asset ${asset.path} to ${newKey}`)

                    const fileInfo = await oldS3Client
                        .headObject({
                            Bucket: process.env.USS_BUCKET,
                            Key: asset.path,
                        })
                        .promise()
                        .catch(async (err) => {
                            if (err.code === "NotFound") {
                                this.logger.error(
                                    "❌ Error getting file info, update path and return, msg: " + err.message,
                                )
                                //update path and return
                                await this.prismaService.assets.update({
                                    where: { id: asset.id },
                                    data: { path: newKey },
                                })

                                await this.prismaService.ip_signature_clips.updateMany({
                                    where: { asset_id: asset.asset_id },
                                    data: {
                                        object_key: newKey,
                                    },
                                })
                            }
                            return Promise.reject(err)
                        })

                    const fileStream = oldS3Client
                        .getObject({
                            Bucket: process.env.USS_BUCKET,
                            Key: asset.path,
                        })
                        .createReadStream()

                    const progressBar = progressBars[index]

                    return newS3Client
                        .upload({
                            Bucket: newS3Info.s3_bucket,
                            Key: newKey,
                            Body: fileStream,
                            ContentType: fileInfo.ContentType,
                        })
                        .on("httpUploadProgress", (progress: any) => {
                            const percentage = Math.round((progress.loaded / progress.total) * 100)
                            progressBar.update(percentage, {
                                filename: asset.path,
                            })
                        })
                        .promise()
                        .then(async () => {
                            progressBar.update(100, {
                                filename: asset.path,
                            })
                            const newFileInfo = await newS3Client
                                .headObject({
                                    Bucket: newS3Info.s3_bucket,
                                    Key: newKey,
                                })
                                .promise()
                            await this.prismaService.assets.update({
                                where: { id: asset.id },
                                data: { path: newKey, head_object: newFileInfo as any },
                            })
                            await this.prismaService.ip_signature_clips.updateMany({
                                where: { asset_id: asset.asset_id },
                                data: {
                                    object_key: newKey,
                                },
                            })
                            this.logger.log(`✅ Migrating asset ${asset.path} to ${newKey} completed`)
                            return Promise.resolve()
                        })
                        .catch((err) => {
                            this.logger.error("❌ Error migrating asset:", err)
                            return Promise.reject(err)
                        })
                }),
            )
        }
        await UtilitiesService.stopTask(taskId)
    }

    //@Cron(CronExpression.EVERY_MINUTE)
    //deprecated
    async migrateThumbnail(): Promise<void> {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        const taskId = TASK_IDS.MIGRATE_THUMBNAIL
        const batchSize = 10
        if (await UtilitiesService.checkTaskRunning(taskId)) {
            this.logger.log("Task is running, skipping")
            return
        }
        await UtilitiesService.startTask(taskId)

        const assets = await this.prismaService.assets.findMany({
            where: {
                NOT: {
                    OR: [{ thumbnail: { startsWith: "public/" } }, { thumbnail: { startsWith: "private/" } }],
                },
                thumbnail: {
                    not: null,
                },
            },
            select: {
                id: true,
                asset_id: true,
                thumbnail: true,
            },
            orderBy: {
                id: "desc",
            },
            //take: 1,
        })
        if (!assets) {
            this.logger.log("No assets need to migrate")
            await UtilitiesService.stopTask(taskId)
            return
        }

        const oldS3Client = new AWS.S3({
            region: process.env.USS_REGION,
            credentials: {
                accessKeyId: process.env.USS_ACCESS_KEY,
                secretAccessKey: process.env.USS_SECRET_KEY,
            },
            s3ForcePathStyle: true,
            endpoint: process.env.USS_ENDPOINT,
        })
        const newS3Info = await this.utilitiesService.getS3Info(false)
        const newS3Client = await this.utilitiesService.getS3Client(false)

        for (let i = 0; i < assets.length; i += batchSize) {
            const batch = assets.slice(i, i + batchSize)
            // Create a multi-progress container for this batch
            const multibar = new cliProgress.MultiBar(
                {
                    clearOnComplete: false,
                    format: "{filename} |{bar}| {percentage}% | {value}/{total} bytes",
                    barCompleteChar: "\u2588",
                    barIncompleteChar: "\u2591",
                },
                cliProgress.Presets.shades_classic,
            )

            // Create progress bars for each asset in the batch
            const progressBars = batch.map((asset) => multibar.create(100, 0, { filename: asset.thumbnail }))

            await Promise.allSettled(
                batch.map(async (asset, index) => {
                    const newKey = "private/ipos/" + asset.thumbnail
                    this.logger.log(`Migrating asset ${asset.thumbnail} to ${newKey}`)

                    const fileInfo = await oldS3Client
                        .headObject({
                            Bucket: process.env.USS_BUCKET,
                            Key: asset.thumbnail,
                        })
                        .promise()
                        .catch(async (err) => {
                            if (err.code === "NotFound") {
                                this.logger.error(
                                    "❌ Error getting file info, update field and return, msg: " + err.message,
                                )
                                //update field and return
                                await this.prismaService.assets.update({
                                    where: { id: asset.id },
                                    data: { thumbnail: newKey },
                                })

                                await this.prismaService.ip_signature_clips.updateMany({
                                    where: { asset_id: asset.asset_id },
                                    data: {
                                        thumbnail: newKey,
                                    },
                                })
                            }
                            return Promise.reject(err)
                        })

                    const fileStream = oldS3Client
                        .getObject({
                            Bucket: process.env.USS_BUCKET,
                            Key: asset.thumbnail,
                        })
                        .createReadStream()

                    const progressBar = progressBars[index]

                    return newS3Client
                        .upload({
                            Bucket: newS3Info.s3_bucket,
                            Key: newKey,
                            Body: fileStream,
                            ContentType: fileInfo.ContentType,
                        })
                        .on("httpUploadProgress", (progress: any) => {
                            const percentage = Math.round((progress.loaded / progress.total) * 100)
                            progressBar.update(percentage, {
                                filename: asset.thumbnail,
                            })
                        })
                        .promise()
                        .then(async () => {
                            progressBar.update(100, {
                                filename: asset.thumbnail,
                            })
                            await this.prismaService.assets.update({
                                where: { id: asset.id },
                                data: { thumbnail: newKey },
                            })
                            await this.prismaService.ip_signature_clips.updateMany({
                                where: { asset_id: asset.asset_id },
                                data: {
                                    thumbnail: newKey,
                                },
                            })
                            this.logger.log(`✅ Migrating asset ${asset.thumbnail} to ${newKey} completed`)
                            return Promise.resolve()
                        })
                        .catch((err) => {
                            this.logger.error("❌ Error migrating asset:", err)
                            return Promise.reject(err)
                        })
                }),
            )
        }
        await UtilitiesService.stopTask(taskId)
    }
}
