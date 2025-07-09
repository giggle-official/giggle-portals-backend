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
    ASSETS_MAX_TAKE,
    UploadedByTaskDto,
    RegisterAssetDto,
    GetPresignedUploadUrlReqDto,
} from "./assets.dto"
import { Prisma } from "@prisma/client"
import { S3InfoDto, UtilitiesService } from "src/common/utilities.service"
import { v4 } from "uuid"
import {
    NewImageProcessResult,
    NewVideoProcessResult,
    TaskQueryResponseDto,
    TaskQueryResponseResult,
    VideoInfoTaskResponseDto,
} from "src/task/task.dto"
import { TaskService } from "src/task/task.service"
import sharp from "sharp"
import { UserService } from "src/user/user.service"
import { S3 } from "aws-sdk"
import * as os from "os"
import * as path from "path"
import { createReadStream } from "fs"
import { PassThrough } from "stream"

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
    ) {}

    async getAssets(user: UserJwtExtractDto, query: AssetListReqDto): Promise<AssetsListResDto> {
        const userProfile = await this.userService.getProfile(user)
        const where: Prisma.assetsWhereInput = {
            user: user.usernameShorted,
        }
        if (query.type && query.type !== "all") where.type = query.type
        if (query.category) where.category = query.category
        if (query.take > ASSETS_MAX_TAKE) query.take = ASSETS_MAX_TAKE
        if (query.exported_by) where.exported_by = query.exported_by
        if (query.source_video) where.source_video = query.source_video

        if (userProfile.widget_info?.widget_tag) where.widget_tag = userProfile.widget_info.widget_tag

        const assets = await this.prismaService.assets.findMany({
            where,
            skip: parseInt(query.skip.toString() || "0"),
            take: parseInt(query.take.toString()),
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

        const data = await Promise.all(
            assets.map(async (asset) => ({
                ...asset,
                public_url: "",
                head_object: asset.head_object as Record<string, any>,
                signed_url: await this.utilitiesService.createS3SignedUrl(asset.path),
                download_url: await this.utilitiesService.createS3SignedUrl(asset.path, true),
                thumbnail: asset.thumbnail ? await this.utilitiesService.createS3SignedUrl(asset.thumbnail) : null,
            })),
        )

        return {
            data,
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
            exported_by: asset.exported_by,
            source_video: asset.source_video,
            asset_info: asset.asset_info,
            exported_by_task_id: asset.exported_by_task_id,
            thumbnail: asset.thumbnail,
            ipfs_key: asset.ipfs_key,
            head_object: asset.head_object as Record<string, any>,
            public_url: "",
            optimized_urls: optimizedUrls,
            signed_url: await this.utilitiesService.createS3SignedUrl(asset.path),
            download_url: await this.utilitiesService.createS3SignedUrl(asset.path, true),
            thumbnail_url: asset.thumbnail ? await this.utilitiesService.createS3SignedUrl(asset.thumbnail) : null,
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
            let isPublic = false
            if (body.object_key.startsWith("public/")) {
                isPublic = true
            }

            const userInfoDetail = await this.userService.getProfile(userInfo)
            const s3Client = await this.utilitiesService.getS3Client(isPublic)
            const s3Info = await this.utilitiesService.getS3Info(isPublic)
            let fileInfo: S3.HeadObjectOutput | null = null

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
                    throw new NotFoundException("File not found in S3")
                }
                throw new InternalServerErrorException("Error checking file in S3")
            }

            const fileType = fileInfo?.ContentType.split("/")[0]
            const assetId = body.object_key.split("/").pop().split(".")[0]

            if (fileType !== "video" && fileType !== "image") throw new BadRequestException("Unknown file type")

            let assetInfo: NewVideoProcessResult | NewImageProcessResult | null = null
            if (fileType === "video") {
                assetInfo = await this.processNewVideo(body.object_key, s3Client)
            } else if (fileType === "image") {
                assetInfo = await this.processNewImage(body.object_key)
            }

            const created = await this.prismaService.$transaction(async (tx) => {
                const created = await tx.assets.create({
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
                return created
            })
            return await this.getAsset(userInfo, created.asset_id)
        } catch (error) {
            this.logger.error("Error uploading asset:", error)
            throw new InternalServerErrorException("Failed to upload asset")
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

            const { filePath, thumbnailKey } = await this.generateThumbnailFromStream(objectKey)

            const thumbnailS3Key = await this.uploadThumbnailToS3(filePath, thumbnailKey, s3Info.s3_bucket, s3Client)

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

    private async generateThumbnailFromStream(objectKey: string): Promise<{ filePath: string; thumbnailKey: string }> {
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
                    resolve({ filePath: writeFile, thumbnailKey: thumbnailFileName })
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
}
