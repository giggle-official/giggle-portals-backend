import { ForbiddenException, Injectable, InternalServerErrorException, NotFoundException } from "@nestjs/common"
import {
    AnnouncementDetailDto,
    AnnouncementListDto,
    AnnouncementListQueryDto,
    CreateAnnouncementDto,
    DeleteAnnouncementDto,
    UpdateAnnouncementDto,
} from "./announcement.dto"
import { Prisma } from "@prisma/client"
import { PrismaService } from "src/common/prisma.service"
import { UserInfoDTO } from "src/user/user.controller"
import { UtilitiesService } from "src/common/utilities.service"

@Injectable()
export class AnnouncementService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilsService: UtilitiesService,
    ) {}

    async create(user: UserInfoDTO, createAnnouncementDto: CreateAnnouncementDto) {
        const ip = await this.prismaService.ip_library.findUnique({
            where: {
                id: createAnnouncementDto.ip_id,
            },
        })
        if (!ip) {
            throw new NotFoundException("IP not found")
        }

        if (ip.owner !== user.usernameShorted) {
            throw new ForbiddenException("You are not the owner of this IP")
        }

        const data: Prisma.ip_announcementCreateInput = {
            ip_id: createAnnouncementDto.ip_id,
            title: createAnnouncementDto.title,
            description: createAnnouncementDto.description,
            creator: user.usernameShorted,
        }

        if (createAnnouncementDto.cover_asset_id) {
            const coverAsset = await this.prismaService.assets.findUnique({
                where: {
                    id: createAnnouncementDto.cover_asset_id,
                    user: user.usernameShorted,
                    type: "image",
                },
            })

            if (!coverAsset) {
                throw new ForbiddenException("Cover asset not found or you are not the owner of this asset")
            }
            data.cover_asset_id = createAnnouncementDto.cover_asset_id
            data.cover_key = coverAsset.path
        }

        if (createAnnouncementDto.video_asset_id) {
            const videoAsset = await this.prismaService.assets.findUnique({
                where: {
                    id: createAnnouncementDto.video_asset_id,
                    user: user.usernameShorted,
                    type: "video",
                },
            })

            if (!videoAsset) {
                throw new ForbiddenException("Video asset not found or you are not the owner of this asset")
            }
            data.video_asset_id = createAnnouncementDto.video_asset_id
            data.video_key = videoAsset.path
        }

        const announcement = await this.prismaService.ip_announcement.create({
            data,
        })

        return this.getAnnouncementDetail(announcement.id)
    }

    async getAnnouncementDetail(id: number): Promise<AnnouncementDetailDto> {
        const announcement = await this.prismaService.ip_announcement.findUnique({
            where: { id },
        })

        if (!announcement) {
            throw new NotFoundException("Announcement not found")
        }

        const s3Info = await this.utilsService.getIpLibraryS3Info()

        return {
            ...announcement,
            cover_url: announcement.cover_key
                ? await this.utilsService.createS3SignedUrl(announcement.cover_key, s3Info)
                : null,
            video_url: announcement.video_key
                ? await this.utilsService.createS3SignedUrl(announcement.video_key, s3Info)
                : null,
        }
    }

    async update(user: UserInfoDTO, updateAnnouncementDto: UpdateAnnouncementDto) {
        const announcement = await this.prismaService.ip_announcement.findUnique({
            where: { id: updateAnnouncementDto.id },
        })

        if (!announcement) {
            throw new NotFoundException("Announcement not found")
        }

        if (announcement.creator !== user.usernameShorted) {
            throw new ForbiddenException("You are not the creator of this announcement")
        }

        const data: Prisma.ip_announcementUpdateInput = {
            title: updateAnnouncementDto.title,
            description: updateAnnouncementDto.description,
            cover_asset_id: null,
            video_asset_id: null,
            cover_key: null,
            video_key: null,
        }

        if (updateAnnouncementDto.cover_asset_id) {
            const coverAsset = await this.prismaService.assets.findUnique({
                where: {
                    id: updateAnnouncementDto.cover_asset_id,
                    user: user.usernameShorted,
                    type: "image",
                },
            })

            if (!coverAsset) {
                throw new ForbiddenException("Cover asset not found or you are not the owner of this asset")
            }
            data.cover_asset_id = updateAnnouncementDto.cover_asset_id
            data.cover_key = coverAsset.path
        }

        if (updateAnnouncementDto.video_asset_id) {
            const videoAsset = await this.prismaService.assets.findUnique({
                where: {
                    id: updateAnnouncementDto.video_asset_id,
                    user: user.usernameShorted,
                    type: "video",
                },
            })

            if (!videoAsset) {
                throw new ForbiddenException("Video asset not found or you are not the owner of this asset")
            }
            data.video_asset_id = updateAnnouncementDto.video_asset_id
            data.video_key = videoAsset.path
        }

        const updatedAnnouncement = await this.prismaService.ip_announcement.update({
            where: { id: updateAnnouncementDto.id },
            data,
        })
        return this.getAnnouncementDetail(updatedAnnouncement.id)
    }

    async listAnnouncements(ipId: number, query: AnnouncementListQueryDto): Promise<AnnouncementListDto> {
        const where: Prisma.ip_announcementWhereInput = {
            ip_id: ipId,
        }
        if (query.search) {
            where.title = {
                contains: query.search,
            }
        }

        const announcements = await this.prismaService.ip_announcement.findMany({
            where,
            skip: (parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
            orderBy: {
                created_at: "desc",
            },
        })

        const total = await this.prismaService.ip_announcement.count({
            where: { ip_id: ipId },
        })

        return {
            data: await Promise.all(announcements.map((announcement) => this.getAnnouncementDetail(announcement.id))),
            total: total,
        }
    }

    async list(query: AnnouncementListQueryDto): Promise<AnnouncementListDto> {
        const where: Prisma.ip_announcementWhereInput = {}
        if (query.search) {
            where.title = {
                contains: query.search,
            }
        }

        if (query.app_id) {
            const app = await this.prismaService.apps.findUnique({
                where: { app_id: query.app_id },
            })
            if (!app) {
                throw new NotFoundException("App not found")
            }
            const appBindIps = await this.prismaService.app_bind_ips.findMany({
                where: { app_id: app.app_id },
            })
            const bindIpIds = appBindIps.map((bind) => bind.ip_id)
            //find fisrt level child ip
            const childIps = await this.prismaService.ip_library_child.findMany({
                where: { parent_ip: { in: bindIpIds } },
            })
            where.ip_id = {
                in: [...bindIpIds, ...childIps.map((bind) => bind.ip_id)],
            }
        }

        const announcements = await this.prismaService.ip_announcement.findMany({
            where,
            skip: (parseInt(query.page) - 1) * parseInt(query.page_size),
            take: parseInt(query.page_size),
            orderBy: {
                created_at: "desc",
            },
        })

        const total = await this.prismaService.ip_announcement.count({
            where,
        })

        return {
            data: await Promise.all(announcements.map((announcement) => this.getAnnouncementDetail(announcement.id))),
            total: total,
        }
    }

    async delete(user: UserInfoDTO, deleteAnnouncementDto: DeleteAnnouncementDto) {
        const announcement = await this.prismaService.ip_announcement.findUnique({
            where: { id: deleteAnnouncementDto.id },
        })

        if (!announcement) {
            throw new NotFoundException("Announcement not found")
        }

        if (announcement.creator !== user.usernameShorted) {
            throw new ForbiddenException("You are not the creator of this announcement")
        }

        await this.prismaService.ip_announcement.delete({
            where: { id: deleteAnnouncementDto.id },
        })

        return {
            success: true,
        }
    }
}
