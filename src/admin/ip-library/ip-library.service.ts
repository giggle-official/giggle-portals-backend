import {
    Injectable,
    Logger,
    InternalServerErrorException,
    NotFoundException,
    ConflictException,
    BadRequestException,
} from "@nestjs/common"
import { Prisma } from "@prisma/client"
import { GetManyParams, ListParams, ListReferenceParams, ListResDto } from "src/admin/request.dto"
import { PrismaService } from "src/common/prisma.service"
import {
    CreateIpLibraryDto,
    DeleteSignatureClipDto,
    IpLibraryTagDto,
    UpdateIpLibraryDto,
    UpdateManyArrayDto,
    UploadSignatureClipsDto,
    UploadSignDto,
} from "src/ip-library/ip-library.dto"
import { v4 as uuidv4 } from "uuid"
import { UtilitiesService } from "src/common/utilities.service"
import { Request } from "express"
import { UserInfoDTO } from "src/user/user.controller"
import { AssetsService } from "src/assets/assets.service"

@Injectable()
export class IpLibraryService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,
        private readonly assetsService: AssetsService,
    ) {}

    private readonly logger = new Logger("IpLibraryService-Admin")

    async list(query: ListParams): Promise<ListResDto<any[]>> {
        const orderBy: Prisma.ip_libraryOrderByWithRelationInput = {
            [query.sort.field]: query.sort.order.toLowerCase() as "asc" | "desc",
        }
        if (query.sort.field === "ip_library_tags") {
            orderBy.ip_library_tags = {
                _count: query.sort.order.toLowerCase() as "asc" | "desc",
            }
        }
        const [list, count] = await this.prismaService.$transaction([
            this.prismaService.ip_library.findMany({
                skip: (parseInt(query.pagination.page) - 1) * parseInt(query.pagination.perPage),
                take: parseInt(query.pagination.perPage),
                orderBy: orderBy,
                include: {
                    ip_library_tags: {
                        orderBy: {
                            tag: "asc",
                        },
                    },
                },
            }),
            this.prismaService.ip_library.count(),
        ])
        return {
            list: list,
            count: count,
        }
    }

    async updateSignatureClip(userInfo: UserInfoDTO, body: UpdateIpLibraryDto, id: number) {
        throw new BadRequestException("not implemented")
        const previous = await this.signatureClip(id)
        if (!previous) throw new NotFoundException("Signature clip not found")
        const newRecord = {
            ...previous,
            name: body.name,
            description: body.description,
        }

        await this.prismaService.$transaction([
            this.prismaService.ip_signature_clips.update({
                where: { id: id },
                data: {
                    name: body.name,
                    description: body.description,
                },
            }),
            this.prismaService.admin_logs.create({
                data: {
                    action: "update_signature_clip",
                    user: userInfo.usernameShorted,
                    data: { id: id, previous: previous, new: newRecord },
                },
            }),
        ])
        return this.signatureClip(id)
    }

    async signatureClip(id: number) {
        const record = await this.prismaService.ip_signature_clips.findUnique({ where: { id: id } })
        if (!record) throw new NotFoundException("Signature clip not found")
        const s3Info = await this.utilitiesService.getIpLibraryS3Info()
        return await this.processSignatureClipUrl(record, s3Info)
    }

    async uploadSignatureClips(userInfo: UserInfoDTO, body: UploadSignatureClipsDto) {
        throw new BadRequestException("not implemented")
        const clips: Prisma.ip_signature_clipsCreateManyInput[] = []
        await Promise.all(
            body.clips.map(async (clip) => {
                const videoInfo = await this.assetsService.processNewVideo(userInfo, clip.key)
                clips.push({
                    ip_id: body.id,
                    name: clip.name,
                    object_key: clip.key,
                    description: clip.description,
                    thumbnail: videoInfo.thumbnail,
                    video_info: videoInfo.videoInfo as any,
                })
            }),
        )

        return await this.prismaService.$transaction(async (p) => {
            const previous = await this.detail(body.id)
            if (body.method === "replace") {
                await p.ip_signature_clips.deleteMany({
                    where: { ip_id: body.id },
                })
            }

            await p.ip_signature_clips.createMany({
                data: clips,
            })
            const newRecord = await this.detail(body.id)
            await p.admin_logs.create({
                data: {
                    action: "upload_signature_clips",
                    user: userInfo.usernameShorted,
                    data: { clips: clips, method: body.method, previous: previous, new: newRecord } as any,
                },
            })

            return newRecord
        })
    }

    async deleteSignatureClip(userInfo: UserInfoDTO, body: DeleteSignatureClipDto) {
        throw new BadRequestException("not implemented")
        const previous = await this.prismaService.ip_signature_clips.findUnique({ where: { id: body.id } })
        if (!previous) throw new NotFoundException("Signature clip not found")
        return await this.prismaService.$transaction([
            this.prismaService.ip_signature_clips.delete({ where: { id: body.id } }),
            this.prismaService.admin_logs.create({
                data: {
                    action: "delete_signature_clip",
                    user: userInfo.usernameShorted,
                    data: { id: body.id, previous: previous },
                },
            }),
        ])
    }

    async detail(id: number) {
        const record = await this.prismaService.ip_library.findUnique({
            where: { id: id },
            include: {
                user_info: true,
                ip_signature_clips: true,
                ip_library_tags: true,
            },
        })
        if (!record) throw new NotFoundException("IP Library not found")
        const coverImages = record?.cover_images as any
        const convertedCoverImages = []
        const s3Info = await this.utilitiesService.getIpLibraryS3Info()

        if (coverImages && Array.isArray(coverImages) && coverImages.length > 0) {
            for (const item of coverImages) {
                convertedCoverImages.push({
                    key: item.key,
                    src: await this.utilitiesService.createS3SignedUrl(item.key, s3Info),
                })
            }
        }

        if (record.ip_signature_clips.length > 0) {
            const convertedSignatureClips = []
            for (const clip of record.ip_signature_clips) {
                convertedSignatureClips.push(await this.processSignatureClipUrl(clip, s3Info))
            }
            record.ip_signature_clips = convertedSignatureClips
        }

        return {
            ...record,
            cover_images: convertedCoverImages,
        }
    }

    async processSignatureClipUrl(clip: any, s3Info: any) {
        return {
            ...clip,
            src: clip.object_key ? await this.utilitiesService.createS3SignedUrl(clip.object_key, s3Info) : null,
            thumbnail: clip.thumbnail ? await this.utilitiesService.createS3SignedUrl(clip.thumbnail, s3Info) : null,
        }
    }

    async signatureClips(query: ListReferenceParams): Promise<ListResDto<any[]>> {
        const [list, count] = await this.prismaService.$transaction([
            this.prismaService.ip_signature_clips.findMany({
                skip: (parseInt(query.pagination.page) - 1) * parseInt(query.pagination.perPage),
                take: parseInt(query.pagination.perPage),
                orderBy: { [query.sort.field]: query.sort.order.toLowerCase() as "asc" | "desc" },
                where: {
                    ip_id: parseInt(query.id),
                },
            }),
            this.prismaService.ip_signature_clips.count({
                where: {
                    ip_id: parseInt(query.id),
                },
            }),
        ])
        return {
            list,
            count,
        }
    }

    async update(userInfo: UserInfoDTO, body: UpdateIpLibraryDto, id: number) {
        throw new BadRequestException("not implemented")
        const params = await this.processParams(body)
        const data = {
            owner: params.owner || null,
            name: params.name,
            director: params.director || [],
            genre: params.genre || [],
            imdb_code: params.imdb_code,
            description: params.description,
            cover_images: params.cover_images,
            is_public: params.is_public,
        }

        const previous = await this.detail(id)
        await this.prismaService.$transaction([
            this.prismaService.ip_library_tags.deleteMany({
                where: { ip_id: id },
            }),
            this.prismaService.ip_library_tags.createMany({
                data: params.ip_library_tags.map((tag: IpLibraryTagDto) => {
                    if (tag.tag) {
                        return {
                            ip_id: id,
                            tag: tag.tag || "",
                            priority: tag?.priority || 0,
                            created_by: userInfo.usernameShorted,
                        }
                    }
                }),
            }),
            this.prismaService.ip_library.update({
                where: { id: id },
                data: data,
            }),
            this.prismaService.admin_logs.create({
                data: {
                    action: "update_ip_library",
                    user: userInfo.usernameShorted,
                    data: { data: data, id: id, previous: previous },
                },
            }),
        ])
        return this.detail(id)
    }

    async getMany(query: GetManyParams) {
        return this.prismaService.ip_library.findMany({
            where: {
                id: { in: query.ids },
            },
        })
    }

    async create(userInfo: UserInfoDTO, body: CreateIpLibraryDto) {
        try {
            const data = await this.processParams(body)

            return await this.prismaService.$transaction(async (p) => {
                const result = await p.admin_logs.create({
                    data: {
                        action: "create_ip_library",
                        user: userInfo.usernameShorted,
                        data: data as any,
                    },
                })

                const newRecord = await p.ip_library.create({
                    data: {
                        owner: data.owner || null,
                        name: data.name,
                        director: data.director || [],
                        genre: data.genre || [],
                        imdb_code: data.imdb_code,
                        description: data.description,
                        cover_images: data.cover_images,
                        is_public: data.is_public,
                    },
                })
                if (data?.ip_library_tags) {
                    await p.ip_library_tags.createMany({
                        data: data?.ip_library_tags.map((tag: IpLibraryTagDto) => {
                            if (tag.tag) {
                                return {
                                    ip_id: newRecord.id,
                                    tag: tag.tag,
                                    priority: tag.priority,
                                    created_by: userInfo.usernameShorted,
                                }
                            }
                        }),
                    })
                }
                return newRecord
            })
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === "P2002") {
                    throw new ConflictException("IP Library name already exists")
                }
            } else throw new InternalServerErrorException("Failed to create IP Library: " + error.message)
        }
    }

    async createMany(userInfo: UserInfoDTO, body: CreateIpLibraryDto[]) {
        return await Promise.all(
            body.map(async (item) => {
                const data = await this.processParams(item)
                const createData = {
                    id: data.id,
                    owner: data.owner || null,
                    name: data.name,
                    director: data.director || [],
                    genre: data.genre || [],
                    imdb_code: data.imdb_code,
                    description: data.description,
                    cover_images: data.cover_images,
                    is_public: data.is_public,
                }
                await this.prismaService.$transaction([
                    this.prismaService.ip_library.create({
                        data: createData,
                    }),
                    this.prismaService.admin_logs.create({
                        data: {
                            action: "import_ip_library",
                            user: userInfo.usernameShorted,
                            data: createData as any,
                        },
                    }),
                ])
            }),
        )
    }

    async updateManyArray(userInfo: UserInfoDTO, body: UpdateManyArrayDto) {
        return await Promise.all(body.ids.map((id, index) => this.update(userInfo, { ...body.data[index], id }, id)))
    }

    async processParams(body: CreateIpLibraryDto | UpdateIpLibraryDto) {
        const director =
            typeof body.director === "string"
                ? body.director.split(",").map((item) => ({ name: item.trim() }))
                : body.director
        const genre =
            typeof body.genre === "string" ? body.genre.split("/").map((item) => ({ name: item.trim() })) : body.genre
        return {
            ...body,
            director: director as any,
            genre: genre as any,
            imdb_code: body.imdb_code?.trim(),
            description: body.description?.trim(),
            cover_images: (body.cover_images as any) || [],
        }
    }

    async signedUploadUrl(body: UploadSignDto) {
        const s3Info = await this.utilitiesService.getIpLibraryS3Info()
        const s3Client = await this.utilitiesService.getS3ClientByS3Info(s3Info)

        const fileName = `ip-library/${uuidv4()}.${body.key.split(".").pop()}`
        const params = {
            Bucket: s3Info.s3_bucket,
            Key: fileName,
            Expires: 86400 * 7,
            ContentType: body.type,
        }

        const signed_url = await s3Client.getSignedUrlPromise("putObject", params)
        return { file_name: fileName, signed_url: signed_url }
    }
}
