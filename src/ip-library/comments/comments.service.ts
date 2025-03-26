import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    CreateCommentDto,
    CommentResponseDto,
    UpdateCommentDto,
    ListCommentReqDto,
    ListCommentResDto,
} from "./comments.dto"
import { PinataSDK } from "pinata-web3"
import { Readable } from "stream"
import { IpLibraryService } from "../ip-library.service"
import { ip_comments, Prisma } from "@prisma/client"
@Injectable()
export class CommentsService {
    constructor(
        private prisma: PrismaService,
        private ipService: IpLibraryService,
    ) {}

    async create(
        dto: CreateCommentDto,
        author: string,
        appId: string,
        image?: Express.Multer.File,
    ): Promise<CommentResponseDto> {
        // app exists
        const appExists = await this.prisma.apps.findUnique({
            where: { app_id: appId },
            include: {
                app_bind_ips: true,
            },
        })

        if (!appExists) {
            throw new BadRequestException("App does not exist")
        }
        // Verify if IP exists and related to the app
        const ipExists = await this.prisma.ip_library.findUnique({
            where: { id: Number(dto.ip_id) },
        })

        if (!ipExists) {
            throw new BadRequestException("IP does not exist")
        }
        const ipDetail = await this.ipService.detail(ipExists.id.toString(), true)

        if (!this._checkIpRelatedToApp(ipDetail.id, appExists.app_bind_ips[0].ip_id)) {
            throw new BadRequestException("IP is not related to the app")
        }

        // Verify reply post exists if specified
        if (dto.reply_post_id) {
            const replyPostExists = await this.prisma.ip_comments.findUnique({
                where: { id: Number(dto.reply_post_id) },
            })

            if (!replyPostExists) {
                throw new BadRequestException("Reply post does not exist")
            }
        }

        // Upload image if provided
        let imageUrl = null
        if (image) {
            imageUrl = await this._processImage(image)
        }

        // Create comment
        const comment = await this.prisma.ip_comments.create({
            data: {
                ip_id: Number(dto.ip_id),
                content: dto.content,
                author: author,
                reply_post_id: dto.reply_post_id ? Number(dto.reply_post_id) : null,
                likes: 0,
                from_app_id: appId,
                image_url: imageUrl,
            },
        })

        return this._mapToResponse(comment)
    }

    async findAll(query: ListCommentReqDto): Promise<ListCommentResDto> {
        const where: Prisma.ip_commentsWhereInput = {
            ip_id: Number(query.ip_id),
            reply_post_id: null, // Only get top-level comments
        }

        const data = await this.prisma.ip_comments.findMany({
            where,
            orderBy: { likes: "desc" },
            skip: Math.max(0, parseInt(query.page.toString()) - 1) * Math.max(0, parseInt(query.page_size.toString())),
            take: Math.max(0, parseInt(query.page_size.toString()) || 10),
        })

        const total = await this.prisma.ip_comments.count({
            where,
        })

        return {
            data: await Promise.all(data.map((comment) => this._mapToResponse(comment))),
            count: total,
        }
    }

    async findOne(id: number): Promise<CommentResponseDto> {
        const comment = await this.prisma.ip_comments.findUnique({
            where: { id },
        })

        if (!comment) {
            throw new NotFoundException(`Comment with ID ${id} not found`)
        }

        return this._mapToResponse(comment)
    }

    async update(id: number, dto: UpdateCommentDto, author: string): Promise<CommentResponseDto> {
        // Check if comment exists and belongs to the author
        const comment = await this.prisma.ip_comments.findUnique({
            where: { id },
        })

        if (!comment) {
            throw new NotFoundException(`Comment with ID ${id} not found`)
        }

        if (comment.author !== author) {
            throw new BadRequestException("You can only update your own comments")
        }

        const updatedComment = await this.prisma.ip_comments.update({
            where: { id },
            data: {
                content: dto.content,
            },
        })

        return this._mapToResponse(updatedComment)
    }

    async remove(id: number, username_in_be: string, appId: string): Promise<void> {
        const app = await this.prisma.apps.findUnique({
            where: { app_id: appId },
            select: {
                user: true,
            },
        })

        if (!app) {
            throw new BadRequestException("App does not exist")
        }

        // Check if comment exists and belongs to the author
        const comment = await this.prisma.ip_comments.findUnique({
            where: { id },
        })

        if (!comment) {
            throw new NotFoundException(`Comment with ID ${id} not found`)
        }

        if (comment.author !== username_in_be && app.user.username_in_be !== username_in_be) {
            throw new BadRequestException("You have no permission to delete this comment")
        }

        await this.prisma.ip_comments.delete({
            where: { id },
        })
    }

    async likeComment(id: number): Promise<CommentResponseDto> {
        const comment = await this.prisma.ip_comments.findUnique({
            where: { id },
        })

        if (!comment) {
            throw new NotFoundException(`Comment with ID ${id} not found`)
        }

        const updatedComment = await this.prisma.ip_comments.update({
            where: { id },
            data: {
                likes: (comment.likes || 0) + 1,
            },
        })

        return this._mapToResponse(updatedComment)
    }

    private async _processImage(file: Express.Multer.File): Promise<string> {
        const pinata = new PinataSDK({
            pinataJwt: process.env.PINATA_JWT,
            pinataGateway: process.env.PINATA_GATEWAY,
        })

        // Create a readable stream from the buffer
        const readable = new Readable()
        readable.push(file.buffer)
        readable.push(null)

        const result = await pinata.upload.stream(readable)

        return process.env.PINATA_GATEWAY + "/ipfs/" + result.IpfsHash
    }

    private async _mapToResponse(comment: ip_comments, includeReplies = true): Promise<CommentResponseDto> {
        // Base comment object
        const user = await this.prisma.users.findUnique({
            where: { username_in_be: comment.author },
        })
        const response: CommentResponseDto = {
            id: comment.id,
            ip_id: comment.ip_id,
            content: comment.content,
            image_url: comment.image_url,
            author: {
                id: user?.username_in_be,
                avatar: user?.avatar,
                username: user?.username,
            },
            reply_post_id: comment.reply_post_id,
            likes: comment.likes || 0,
            from_app_id: comment.from_app_id,
            created_at: comment.created_at,
            updated_at: comment.updated_at,
            reply_post: [],
        }

        // If we should include replies and this is a top-level comment (not a reply itself)
        if (includeReplies && !comment.reply_post_id) {
            // Find all direct replies to this comment
            const replies = await this.prisma.ip_comments.findMany({
                where: {
                    reply_post_id: comment.id,
                },
                orderBy: {
                    likes: "desc",
                },
            })

            // Recursively map replies (but don't look for nested replies to avoid excessive queries)
            if (replies.length > 0) {
                response.reply_post = await Promise.all(replies.map((reply) => this._mapToResponse(reply, false)))
            }
        }

        return response
    }

    private async _checkIpRelatedToApp(ip_id: number, app_bind_ip_id: number): Promise<boolean> {
        if (ip_id === app_bind_ip_id) {
            //is app bind ip
            return true
        }

        const parentIp = await this.prisma.ip_library_child.findFirst({
            where: {
                ip_id: ip_id,
            },
            select: {
                parent_ip: true,
            },
        })
        if (parentIp && parentIp.parent_ip === app_bind_ip_id) {
            //parent ip bind to the app
            return true
        }

        if (parentIp && parentIp.parent_ip) {
            //top ip bind to the app
            const topIp = await this.prisma.ip_library_child.findFirst({
                where: {
                    ip_id: parentIp.parent_ip,
                },
                select: {
                    parent_ip: true,
                },
            })
            if (topIp.parent_ip === app_bind_ip_id) {
                return true
            }
        }
        return false
    }
}
