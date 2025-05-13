import { PrismaService } from "./prisma.service"
import { BadRequestException, InternalServerErrorException, Logger } from "@nestjs/common"
import * as AWS from "aws-sdk"
import { Injectable } from "@nestjs/common"

export class S3InfoDto {
    s3_bucket: string
    s3_access_key: string
    s3_secret_key: string
    s3_region: string
    s3_endpoint: string
    s3_static_endpoint?: string
}

@Injectable()
export class UtilitiesService {
    constructor(private readonly prismaService: PrismaService) {}
    private readonly logger = new Logger(UtilitiesService.name)

    public async createS3SignedUrl(key: string, s3Info: S3InfoDto, download?: boolean): Promise<string> {
        try {
            if (!key) return ""
            const endpoint = s3Info.s3_static_endpoint || s3Info.s3_endpoint
            const s3Client = new AWS.S3({
                region: s3Info.s3_region,
                credentials: {
                    accessKeyId: s3Info.s3_access_key,
                    secretAccessKey: s3Info.s3_secret_key,
                },
                endpoint: s3Info.s3_static_endpoint || s3Info.s3_endpoint,
                s3ForcePathStyle: true,
            })
            // Ensure the expiration time is consistent within the same day
            const now = new Date()
            const expirationDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59)
            const expiresInSeconds = Math.floor((expirationDate.getTime() - now.getTime()) / 1000)
            const params = {
                Bucket: s3Info.s3_bucket,
                Key: key,
                Expires: expiresInSeconds,
                ResponseContentDisposition: download ? "attachment" : undefined,
                ResponseContentType: await this.getS3ContentType(key),
            }

            if (params.ResponseContentType === "") {
                delete params.ResponseContentType
            }

            return await s3Client.getSignedUrlPromise("getObject", params)
        } catch (error) {
            this.logger.error("Error creating S3 signed URL:", error)
            throw new InternalServerErrorException("Failed to create video preview URL")
        }
    }

    public async getS3Info(usernameShorted: string): Promise<S3InfoDto> {
        const user = await this.prismaService.users.findUnique({
            where: { username_in_be: usernameShorted },
        })
        if (!user) {
            throw new BadRequestException("User not found")
        }
        return {
            s3_bucket: process.env.USS_BUCKET,
            s3_access_key: process.env.USS_ACCESS_KEY,
            s3_secret_key: process.env.USS_SECRET_KEY,
            s3_region: process.env.USS_REGION,
            s3_endpoint: process.env.USS_ENDPOINT,
            s3_static_endpoint: process.env.USS_STATIC_ENDPOINT,
        }
    }

    public async getIpLibraryS3Info(): Promise<S3InfoDto> {
        return {
            //s3_bucket: process.env.USS_IP_LIBRARY_BUCKET,
            //s3_access_key: process.env.USS_IP_LIBRARY_ACCESS_KEY,
            //s3_secret_key: process.env.USS_IP_LIBRARY_SECRET_KEY,
            //s3_region: process.env.USS_IP_LIBRARY_REGION,
            //s3_endpoint: process.env.USS_IP_LIBRARY_ENDPOINT,
            s3_bucket: process.env.USS_BUCKET,
            s3_access_key: process.env.USS_ACCESS_KEY,
            s3_secret_key: process.env.USS_SECRET_KEY,
            s3_region: process.env.USS_REGION,
            s3_endpoint: process.env.USS_ENDPOINT,
            s3_static_endpoint: process.env.USS_STATIC_ENDPOINT,
        }
    }

    public async getS3ContentType(key: string): Promise<string> {
        try {
            const extension = key.split(".").pop()?.toLowerCase()
            if (!extension) return ""

            if (extension === "mp4") {
                return "video/mp4"
            }

            if (["jpg", "png", "gif"].includes(extension)) {
                return `image/${extension}`
            }

            return ""
        } catch (error) {
            this.logger.error("Error getting content type:", error)
            return ""
        }
    }

    public async getS3ClientByS3Info(s3Info: S3InfoDto): Promise<AWS.S3> {
        return new AWS.S3({
            region: s3Info.s3_region,
            credentials: {
                accessKeyId: s3Info.s3_access_key,
                secretAccessKey: s3Info.s3_secret_key,
            },
            endpoint: s3Info.s3_endpoint,
            s3ForcePathStyle: true,
        })
    }

    public async getS3Client(usernameShorted: string): Promise<AWS.S3> {
        const s3Info = await this.getS3Info(usernameShorted)
        return new AWS.S3({
            region: s3Info.s3_region,
            credentials: {
                accessKeyId: s3Info.s3_access_key,
                secretAccessKey: s3Info.s3_secret_key,
            },
            endpoint: s3Info.s3_endpoint,
            s3ForcePathStyle: true,
        })
    }

    public static generateRandomApiKey(): string {
        return [...Array(32)].map(() => Math.random().toString(36)[2]).join("")
    }

    public static formatBigNumber(num: number): string {
        if (num < 1000) {
            return num.toString()
        }
        if (num < 1000000) {
            return (num / 1000).toFixed(2) + "K"
        }
        return (num / 1000000).toFixed(2) + "M"
    }

    public static async checkTaskRunning(taskId: number): Promise<boolean> {
        const prisma = new PrismaService()
        let taskRunning = await prisma.ai_router_requesting.findUnique({
            where: {
                id: taskId,
            },
        })
        //check update time
        if (taskRunning && taskRunning.updated_at < new Date(Date.now() - 1000 * 60 * 5)) {
            //5 minutes
            //if task is running for more than 5 minutes, set is_requesting to false
            taskRunning = await prisma.ai_router_requesting.update({
                where: { id: taskId },
                data: { is_requesting: false },
            })
        }
        return taskRunning && taskRunning.is_requesting
    }

    public static async startTask(taskId): Promise<void> {
        const prisma = new PrismaService()
        await prisma.ai_router_requesting.update({
            where: {
                id: taskId,
            },
            data: {
                is_requesting: true,
            },
        })
    }

    public static async stopTask(taskId: number): Promise<void> {
        const prisma = new PrismaService()
        await prisma.ai_router_requesting.update({
            where: {
                id: taskId,
            },
            data: {
                is_requesting: false,
            },
        })
    }
}
