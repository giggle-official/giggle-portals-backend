import { PrismaService } from "./prisma.service"
import { InternalServerErrorException, Logger } from "@nestjs/common"
import * as AWS from "aws-sdk"
import { Injectable } from "@nestjs/common"
import { Request } from "express"
import { readFileSync } from "fs"

export class S3InfoDto {
    s3_bucket: string
    s3_access_key: string
    s3_secret_key: string
    s3_region: string
    s3_prefix: string
}

@Injectable()
export class UtilitiesService {
    private cloudFront: AWS.CloudFront.Signer
    private readonly logger = new Logger(UtilitiesService.name)
    private readonly cloudFrontDomain: string

    constructor() {
        if (!process.env.CLOUDFRONT_KEY_PAIR_ID || !process.env.CLOUDFRONT_PRIVATE_KEY_PATH) {
            throw new Error("CloudFront key pair id or private key path not found")
        }

        if (!process.env.CLOUDFRONT_DOMAIN) {
            throw new Error("CloudFront domain not found")
        }

        const privateKey = readFileSync(process.env.CLOUDFRONT_PRIVATE_KEY_PATH, "utf8")

        if (!privateKey) {
            throw new Error("CloudFront private key not found")
        }

        this.cloudFront = new AWS.CloudFront.Signer(
            process.env.CLOUDFRONT_KEY_PAIR_ID, // CloudFront Key Pair ID
            privateKey,
        )

        this.cloudFrontDomain = process.env.CLOUDFRONT_DOMAIN

        //check s3 info
        if (
            !process.env.S3_BUCKET_NAME ||
            !process.env.S3_ACCESS_KEY ||
            !process.env.S3_SECRET_KEY ||
            !process.env.S3_REGION
        ) {
            throw new Error("S3 info not found")
        }
    }

    public async createS3SignedUrl(key: string, download?: boolean): Promise<string> {
        try {
            if (!key) return ""

            const fileUrl = `${this.cloudFrontDomain}/${key}`

            if (key.startsWith("public/")) {
                return fileUrl
            }

            const now = new Date()
            const expirationDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 23, 59, 59)

            if (download) {
                // Use custom policy for download with Content-Disposition
                const policy = {
                    Statement: [
                        {
                            Resource: `${this.cloudFrontDomain}/${key}*`, // Allow query parameters
                            Condition: {
                                DateLessThan: {
                                    "AWS:EpochTime": expirationDate.getTime(),
                                },
                            },
                        },
                    ],
                }

                const baseUrl = this.cloudFront.getSignedUrl({
                    url: fileUrl,
                    policy: JSON.stringify(policy),
                })

                // Add response headers as query parameters
                const url = new URL(baseUrl)
                url.searchParams.append("response-content-disposition", "attachment")
                return url.toString()
            } else {
                // Simple signed URL for viewing
                return this.cloudFront.getSignedUrl({
                    url: fileUrl,
                    expires: expirationDate.getTime(), // Use timestamp, not Date object
                })
            }
        } catch (error) {
            this.logger.error("Error creating S3 signed URL:", error)
            throw new InternalServerErrorException("Failed to create video preview URL")
        }
    }

    public async getS3Info(isPublic: boolean): Promise<S3InfoDto> {
        return {
            s3_bucket: process.env.S3_BUCKET_NAME,
            s3_access_key: process.env.S3_ACCESS_KEY,
            s3_secret_key: process.env.S3_SECRET_KEY,
            s3_region: process.env.S3_REGION,
            s3_prefix: isPublic ? process.env.S3_PUBLIC_PREFIX : process.env.S3_PRIVATE_PREFIX,
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

    public async getS3Client(isPublic: boolean): Promise<AWS.S3> {
        const s3Info = await this.getS3Info(isPublic)
        return new AWS.S3({
            region: s3Info.s3_region,
            credentials: {
                accessKeyId: s3Info.s3_access_key,
                secretAccessKey: s3Info.s3_secret_key,
            },
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

    public static async checkTaskRunning(taskId: number, timeout: number = 1000 * 60 * 5): Promise<boolean> {
        const prisma = new PrismaService()
        let taskRunning = await prisma.ai_router_requesting.findUnique({
            where: {
                id: taskId,
            },
        })

        if (!taskRunning) {
            return false
        }

        //check update time
        if (taskRunning && taskRunning.updated_at < new Date(Date.now() - timeout)) {
            //5 minutes
            //if task is running for more than 5 minutes, set is_requesting to false
            taskRunning = await prisma.ai_router_requesting.upsert({
                where: { id: taskId },
                update: { is_requesting: false },
                create: { id: taskId, is_requesting: false },
            })
        }
        return taskRunning && taskRunning.is_requesting
    }

    public static async startTask(taskId: number): Promise<void> {
        const prisma = new PrismaService()
        await prisma.ai_router_requesting.upsert({
            where: {
                id: taskId,
            },
            update: {
                is_requesting: true,
            },
            create: {
                id: taskId,
                is_requesting: true,
            },
        })
    }

    public static async stopTask(taskId: number): Promise<void> {
        const prisma = new PrismaService()
        await prisma.ai_router_requesting.upsert({
            where: {
                id: taskId,
            },
            update: {
                is_requesting: false,
            },
            create: {
                id: taskId,
                is_requesting: false,
            },
        })
    }

    public static async uploadToPublicS3(file: Express.Multer.File, usernameShorted: string): Promise<string> {
        const s3 = new AWS.S3({
            region: process.env.S3_PUBLIC_REGION,
            credentials: {
                accessKeyId: process.env.S3_PUBLIC_ACCESS_KEY,
                secretAccessKey: process.env.S3_PUBLIC_SECRET_KEY,
            },
        })

        //generate a random string
        const key_prefix = process.env.S3_PUBLIC_KEY_PREFIX
        const file_extension = file.originalname.split(".").pop()
        const randomString = Math.random().toString(36).substring(2, 30)
        const keyWithPrefix = `${key_prefix}/${usernameShorted}/${randomString}.${file_extension}`
        const keyWithoutPrefix = `${usernameShorted}/${randomString}.${file_extension}`

        await s3
            .putObject({
                Bucket: process.env.S3_PUBLIC_BUCKET_NAME,
                Key: keyWithPrefix,
                Body: file.buffer,
                ContentType: file.mimetype,
            })
            .promise()

        return `${process.env.S3_PUBLIC_CDN_DOMAIN}/${keyWithoutPrefix}`
    }

    public static async getUsersIp(req: Request): Promise<string> {
        if (typeof req.headers["x-forwarded-for"] === "string") {
            return req.headers["x-forwarded-for"].split(",")[0]
        }

        if (typeof req.headers["x-real-ip"] === "string") {
            return req.headers["x-real-ip"]
        }

        return req.socket.remoteAddress
    }
}
