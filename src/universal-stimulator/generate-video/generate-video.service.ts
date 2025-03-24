import {
    Inject,
    forwardRef,
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    InternalServerErrorException,
} from "@nestjs/common"
import { AssetsService } from "src/assets/assets.service"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { TaskService } from "src/task/task.service"
import { UserInfoDTO } from "src/user/user.controller"
import {
    CancelGenerateVideoRequestDto,
    GenerateStatusDto,
    GenerateVideoDetailDto,
    GenerateVideoListDto,
    GenerateVideoParamsDto,
    GenerateVideoRequestDto,
    GenerateVideoTaskResponseDto,
    ReGenerateVideoRequestDto,
    TaskGenerateVideoDto,
} from "./generate-video.dto"
import {
    TaskCreateDto,
    TaskCreateResponseDto,
    TaskQueryDto,
    TaskQueryResponseDto,
    TaskQueryResponseResult,
} from "src/task/task.dto"
import { v4 as uuidv4 } from "uuid"
import { AssetDetailDto } from "src/assets/assets.dto"
import { CreditService } from "src/credit/credit.service"
import { UserService } from "src/user/user.service"

export const AllowPixel = {
    "16:9": {
        width: 1280,
        height: 720,
    },
    "9:16": {
        width: 720,
        height: 1280,
    },
    "1:1": {
        width: 1024,
        height: 1024,
    },
}

@Injectable()
export class GenerateVideoService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,

        @Inject(forwardRef(() => AssetsService))
        private readonly assetsService: AssetsService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => CreditService))
        private readonly creditService: CreditService,

        @Inject(forwardRef(() => TaskService))
        private readonly taskService: TaskService,
    ) {}

    private readonly logger = new Logger(GenerateVideoService.name)
    private readonly generateSeconds = 5

    async getList(userInfo: UserInfoDTO, take: number = 10): Promise<GenerateVideoListDto> {
        const response = await this.prismaService.generate_video_request.findMany({
            where: {
                user: userInfo.usernameShorted,
                current_status: {
                    not: { in: [GenerateStatusDto.CANCELLED] },
                },
            },
            select: {
                id: true,
                current_status: true,
                object_key: true,
                from_asset_id: true,
                generate_video_result: {
                    take: 1,
                    orderBy: {
                        created_at: "desc",
                    },
                },
            },
            orderBy: {
                created_at: "desc",
            },
            take: take,
        })

        const count = await this.prismaService.generate_video_request.count({
            where: { user: userInfo.usernameShorted, current_status: { not: { in: [GenerateStatusDto.CANCELLED] } } },
        })

        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

        const result = await Promise.all(
            response.map(async (item) => {
                let object_key: string | null = null
                let object_url: string | null = null
                if (item.generate_video_result.length > 0) {
                    object_key = item.generate_video_result[0].thumbnail
                    object_url = await this.utilitiesService.createS3SignedUrl(object_key, s3Info)
                }
                return {
                    id: item.id,
                    current_status: item.current_status as GenerateStatusDto,
                    object_key: object_key,
                    object_url: object_url,
                }
            }),
        )

        return {
            total: count,
            data: result,
        }
    }

    async detail(user: UserInfoDTO, id: number): Promise<GenerateVideoDetailDto> {
        const record = await this.prismaService.generate_video_request.findUnique({
            where: { id, user: user.usernameShorted, current_status: { not: { in: [GenerateStatusDto.CANCELLED] } } },
            include: {
                generate_video_result: {
                    select: {
                        id: true,
                        thumbnail: true,
                        object_key: true,
                        generate_params: true,
                        current_status: true,
                        to_asset_id: true,
                        created_at: true,
                        updated_at: true,
                    },
                    orderBy: {
                        created_at: "desc",
                    },
                },
            },
        })
        if (!record) throw new NotFoundException("Generate video not found")

        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)

        return {
            id: record.id,
            current_status: record.current_status as GenerateStatusDto,
            progress: 0,
            model: record.model,
            object_key: record.object_key,
            object_url: await this.utilitiesService.createS3SignedUrl(record.object_key, s3Info),
            type: record.type,
            prompt: record.prompt,
            generate_params: record.generate_params as any as GenerateVideoParamsDto,
            generate_video_result: await Promise.all(
                record.generate_video_result.map(async (item: any) => ({
                    id: item.id,
                    thumbnail: item.thumbnail,
                    thumbnail_url: await this.utilitiesService.createS3SignedUrl(item.thumbnail, s3Info),
                    object_key: item.object_key,
                    generate_params: item.generate_params as any as GenerateVideoParamsDto,
                    current_status: item.current_status as GenerateStatusDto,
                    object_url: await this.utilitiesService.createS3SignedUrl(item.object_key, s3Info),
                    object_download_url: await this.utilitiesService.createS3SignedUrl(item.object_key, s3Info, true),
                    to_asset_id: item.to_asset_id,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                })),
            ),
        }
    }

    async create(user: UserInfoDTO, body: GenerateVideoRequestDto) {
        if (!body.from_asset_id && !body.prompt) {
            throw new BadRequestException("Either from_asset_id or prompt must be provided")
        }

        if (!body.from_asset_id && !body.ratio) {
            throw new BadRequestException("Either from_asset_id or ratio must be provided")
        }

        const userProfile = await this.userService.getProfile(user)
        const consumeCredit = this.creditService.computeGenerateCredit(
            userProfile.subscription_info,
            this.generateSeconds,
            "generate_video",
        )
        if (userProfile.credit < consumeCredit) throw new BadRequestException("insufficient credits")

        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)
        let method: "NewVideoService.FromTxt" | "NewVideoService.FromImg"
        let params: TaskGenerateVideoDto
        let asset: AssetDetailDto | null = null
        if (body.from_asset_id) {
            //this indicate user want to generate video from asset
            delete body.ratio
            asset = await this.assetsService.getAsset(user, body.from_asset_id)
            if (!asset) throw new NotFoundException("Asset not found")
            if (asset.type !== "image") throw new BadRequestException("Asset is not an image")
            method = "NewVideoService.FromImg"
            const { width, height } = await this.zoomOutPixelByRation(
                { width: asset.asset_info?.width || 1280, height: asset.asset_info?.height || 720 },
                720, // current we only support max 1280x720
            )
            const { model, user_args } = this.getModelConfig(body, "p2v", asset.path, width, height, body.ratio)
            params = {
                bucket: s3Info.s3_bucket,
                file_name: asset.path,
                user_args: user_args,
                style_name: model,
            }
        } else {
            method = "NewVideoService.FromTxt"
            const { width, height } = await this.getPixelByRatio(body.ratio)
            const { model, user_args } = this.getModelConfig(body, "t2v", undefined, width, height, body.ratio)
            params = {
                bucket: s3Info.s3_bucket,
                user_args: user_args,
                style_name: model,
            }
        }

        const createTaskParam: TaskCreateDto = {
            method: method,
            params: [params],
            id: uuidv4(),
        }
        const task: TaskCreateResponseDto = await this.taskService.taskCreateRequest(createTaskParam)
        if (!task?.result?.task_id) {
            this.logger.error(
                `Failed to create generate video task: ${JSON.stringify(task)}, createParams: ${JSON.stringify(createTaskParam)}`,
            )
            throw new InternalServerErrorException("Failed to create generate video task")
        }

        const result = await this.prismaService.$transaction(async (tx) => {
            const created = await tx.generate_video_request.create({
                data: {
                    user: user.usernameShorted,
                    model: body.model,
                    from_asset_id: body.from_asset_id || undefined,
                    object_key: asset?.path || undefined,
                    type: method,
                    prompt: body.prompt || undefined,
                    generate_params: { ratio: body.ratio || null },
                    current_status: GenerateStatusDto.PROCESSING,
                },
            })

            const videoResult = await tx.generate_video_result.create({
                data: {
                    request_id: created.id,
                    generate_task_id: task.result.task_id,
                    current_status: GenerateStatusDto.PROCESSING,
                    generate_params: {
                        ratio: body.ratio || null,
                        width: params.user_args[0].value,
                        height: params.user_args[1].value,
                        prompt: body.prompt || null,
                    },
                    task_request: createTaskParam as any,
                },
            })
            return { created, videoResult }
        })

        //pending credit
        await this.creditService.pendingCredit(
            user,
            consumeCredit,
            this.creditService.generateRelatedId(result.videoResult.id, "generate_video"),
        )
        return this.detail(user, result.created.id)
    }

    async reGenerate(user: UserInfoDTO, body: ReGenerateVideoRequestDto) {
        const record = await this.prismaService.generate_video_request.findUnique({
            where: {
                id: body.id,
                user: user.usernameShorted,
                current_status: { not: { in: [GenerateStatusDto.CANCELLED] } },
            },
        })
        if (!record) throw new NotFoundException("Generate video not found")

        const userProfile = await this.userService.getProfile(user)
        const consumeCredit = this.creditService.computeGenerateCredit(
            userProfile.subscription_info,
            this.generateSeconds,
            "generate_video",
        )
        if (userProfile.credit < consumeCredit) throw new BadRequestException("insufficient credits")

        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)
        const method = record.type as "NewVideoService.FromImg" | "NewVideoService.FromTxt"
        let params: TaskGenerateVideoDto
        if (method === "NewVideoService.FromImg") {
            delete body.ratio
            const asset = await this.assetsService.getAsset(user, record.from_asset_id)
            if (!asset) throw new NotFoundException("Asset not found")
            if (asset.type !== "image") throw new BadRequestException("Asset is not an image")
            const { width, height } = await this.zoomOutPixelByRation(
                { width: asset.asset_info?.width || 1280, height: asset.asset_info?.height || 720 },
                720, // current we only support max 1280x720
            )
            const { model, user_args } = this.getModelConfig(body, "p2v", asset.path, width, height, body.ratio)
            params = {
                bucket: s3Info.s3_bucket,
                file_name: asset.path,
                user_args: user_args,
                style_name: model,
            }
        } else {
            const { width, height } = await this.getPixelByRatio(body.ratio)
            const { model, user_args } = this.getModelConfig(body, "t2v", undefined, width, height, body.ratio)
            params = {
                bucket: s3Info.s3_bucket,
                user_args: user_args,
                style_name: model,
            }
        }
        const createTaskParam: TaskCreateDto = {
            method: method,
            params: [params],
            id: uuidv4(),
        }
        const task: TaskCreateResponseDto = await this.taskService.taskCreateRequest(createTaskParam)
        if (!task?.result?.task_id) {
            this.logger.error(
                `Failed to create generate video task: ${JSON.stringify(task)}, createParams: ${JSON.stringify(createTaskParam)}`,
            )
            throw new InternalServerErrorException("Failed to create generate video task")
        }

        const result = await this.prismaService.$transaction(async (tx) => {
            const created = await tx.generate_video_request.update({
                where: { id: body.id },
                data: {
                    current_status: GenerateStatusDto.PROCESSING,
                    prompt: body.prompt || undefined,
                    generate_params: { ratio: body.ratio || null },
                },
            })

            const videoResult = await tx.generate_video_result.create({
                data: {
                    request_id: created.id,
                    generate_task_id: task.result.task_id,
                    current_status: GenerateStatusDto.PROCESSING,
                    generate_params: {
                        ratio: body.ratio || null,
                        width: params.user_args[0].value,
                        height: params.user_args[1].value,
                        prompt: body.prompt || null,
                    },
                    task_request: createTaskParam as any,
                },
            })
            return { created, videoResult }
        })
        //pending credit
        await this.creditService.pendingCredit(
            user,
            consumeCredit,
            this.creditService.generateRelatedId(result.videoResult.id, "generate_video"),
        )
        return this.detail(user, result.created.id)
    }

    async getPixelByRatio(ratio: "16:9" | "9:16" | "1:1"): Promise<{ width: number; height: number }> {
        switch (ratio) {
            case "16:9":
                return AllowPixel["16:9"]
            case "9:16":
                return AllowPixel["9:16"]
            case "1:1":
                return AllowPixel["1:1"]
            default:
                throw new BadRequestException("Invalid ratio")
        }
    }

    async cancel(user: UserInfoDTO, body: CancelGenerateVideoRequestDto) {
        const record = await this.prismaService.generate_video_request.findUnique({
            where: { id: body.id, user: user.usernameShorted },
        })
        if (!record) throw new NotFoundException("Generate video not found")
        if (record.current_status === GenerateStatusDto.PROCESSING)
            throw new BadRequestException("video is processing, cannot cancel")
        return await this.prismaService.generate_video_request.update({
            where: { id: body.id, user: user.usernameShorted },
            data: { current_status: GenerateStatusDto.CANCELLED },
            select: { id: true, current_status: true },
        })
    }

    async zoomOutPixelByRation(
        { width, height }: { width: number; height: number },
        maxPixel: number,
    ): Promise<{ width: number; height: number }> {
        if (width < maxPixel && height < maxPixel) {
            return { width, height }
        }

        if (width === height && width > maxPixel) {
            return AllowPixel["1:1"]
        } else if (width > height && width > maxPixel) {
            return AllowPixel["16:9"]
        } else if (height > width && height > maxPixel) {
            return AllowPixel["9:16"]
        }
        //default
        return AllowPixel["16:9"]
    }

    async checkGenerateTaskStatus() {
        this.logger.log(`Checking generate video task status`)
        const pendingTasks = await this.prismaService.generate_video_result.findMany({
            where: {
                current_status: GenerateStatusDto.PROCESSING,
            },
            include: {
                request_info: {
                    include: {
                        user_info: {
                            select: {
                                email: true,
                                username_in_be: true,
                            },
                        },
                    },
                },
            },
        })
        this.logger.log(`Found ${pendingTasks.length} generate video pending tasks`)

        for (const task of pendingTasks) {
            try {
                let type: "Txt2Video" | "Img2Video"
                if (task.request_info.type === "NewVideoService.FromTxt") {
                    type = "Txt2Video"
                } else {
                    type = "Img2Video"
                }
                const taskQuery: TaskQueryDto = {
                    method: "QueryService.Task",
                    params: [
                        { task_id: task.generate_task_id, task_type: type, user_id: task.request_info.user_info.email },
                    ],
                    id: uuidv4(),
                }
                const response: TaskQueryResponseDto<TaskQueryResponseResult> =
                    await this.taskService.taskQueryRequest(taskQuery)
                if (response.result.status === 2) {
                    const result = response.result.result as GenerateVideoTaskResponseDto
                    //create asset
                    const asset = await this.assetsService.uploadedByTask(
                        { usernameShorted: task.request_info.user_info.username_in_be },
                        {
                            object_key: result,
                            name: result,
                            category: "exports",
                            source_video: task.request_id,
                            exported_by: "generate-video",
                            task_id: task.generate_task_id,
                        },
                    )
                    //update generate_video_result
                    await this.prismaService.generate_video_result.update({
                        where: { id: task.id },
                        data: {
                            current_status: GenerateStatusDto.COMPLETED,
                            object_key: result,
                            to_asset_id: asset.id,
                            thumbnail: asset.thumbnail,
                            updated_at: new Date(),
                            task_response: response as any,
                        },
                    })

                    //complete credit
                    const relatedIds = this.creditService.generateRelatedId(task.id, "generate_video")
                    await this.creditService.completeCredit(relatedIds)
                } else if (response.result.status === 3) {
                    this.logger.error(
                        `Generate video task ${task.generate_task_id} failed, response: ${JSON.stringify(response)}`,
                    )

                    //refund credit
                    const relatedIds = this.creditService.generateRelatedId(task.id, "generate_video")
                    await this.creditService.refundCredit(relatedIds)

                    await this.prismaService.generate_video_result.update({
                        where: { id: task.id },
                        data: {
                            current_status: GenerateStatusDto.FAILED,
                            task_response: response as any,
                            updated_at: new Date(),
                        },
                    })
                }
            } catch (error) {
                this.logger.error(
                    `Error checking generate video task status for task ${task.generate_task_id}: ${error.message}`,
                    error,
                )
                continue
            }
        }

        //check status
        const allSubResult = await this.prismaService.generate_video_request.findMany({
            include: {
                generate_video_result: true,
            },
        })
        await Promise.all(
            allSubResult.map(async (item) => {
                const allCompleted = item.generate_video_result.every(
                    (item) => item.current_status !== GenerateStatusDto.PROCESSING,
                )
                const hasFailed = item.generate_video_result.some(
                    (item) => item.current_status === GenerateStatusDto.FAILED,
                )
                let status: GenerateStatusDto
                if (allCompleted) {
                    status = hasFailed ? GenerateStatusDto.FAILED : GenerateStatusDto.COMPLETED
                } else {
                    status = GenerateStatusDto.PROCESSING
                }
                await this.prismaService.generate_video_request.update({
                    where: { id: item.id },
                    data: { current_status: status },
                })
            }),
        )

        this.logger.log("Generate video task status check completed")
    }

    getModelConfig(
        body: GenerateVideoRequestDto | ReGenerateVideoRequestDto,
        type: "p2v" | "t2v",
        asset_path?: string,
        width?: number,
        height?: number,
        ratio: "16:9" | "9:16" | "1:1" = "16:9",
    ): {
        model: "MiniMax" | "HunYuan" | "CogVideoX" | "Wan2.1" | "KLing-v1-6"
        user_args: any
    } {
        if (body.model === "MiniMax-video-01" && type === "p2v")
            // p2v minimax-video-01
            return {
                model: "MiniMax",
                user_args: [
                    { root: "4", name: "image_name", value: asset_path },
                    { root: "7", name: "model", value: "video-01" },
                    { root: "9", name: "text", value: body.prompt || "" },
                    { root: "999", name: "file_prefix", value: "pic_to_video_" },
                ],
            }
        else if (body.model === "Minimax anime" && type === "p2v")
            // p2v minimax-video-01-live2d
            return {
                model: "MiniMax",
                user_args: [
                    { root: "4", name: "image_name", value: asset_path },
                    { root: "7", name: "model", value: "video-01-live2d" },
                    { root: "9", name: "text", value: body.prompt || "" },
                    { root: "999", name: "file_prefix", value: "pic_to_video_" },
                ],
            }
        else if (body.model === "MiniMax-S2V-01" && type === "p2v")
            // p2v minimax
            return {
                model: "MiniMax",
                user_args: [
                    { root: "4", name: "image_name", value: asset_path },
                    { root: "7", name: "model", value: "S2V-01" },
                    { root: "9", name: "text", value: body.prompt || "" },
                    { root: "999", name: "file_prefix", value: "pic_to_video_" },
                ],
            }
        else if (body.model === "Wan2.1" && type === "p2v")
            // p2v minimax
            return {
                model: "Wan2.1",
                user_args: [
                    { root: "1", name: "image", value: asset_path },
                    { root: "2", name: "text", value: body.prompt || "" },
                    { root: "7", name: "width", value: width },
                    { root: "7", name: "height", value: height },
                    { root: "999", name: "filename_prefix", value: "pic_to_video_" },
                ],
            }
        else if (body.model === "KLing-v1-6" && type === "p2v")
            // kling v1-6
            return {
                model: "KLing-v1-6",
                user_args: [
                    { root: "1", name: "image", value: asset_path },
                    { root: "2", name: "prompt", value: body.prompt || "" },
                    { root: "4", name: "filename_prefix", value: "pic_to_video_" },
                ],
            }
        else if (body.model.toLowerCase() === "sophon-one" && type === "p2v")
            //p2v default
            return {
                model: "CogVideoX",
                user_args: [
                    { root: "8", name: "width", value: width },
                    { root: "8", name: "height", value: height },
                    { root: "5", name: "prompt", value: body.prompt || "" },
                ],
            }
        else if (body.model.toLowerCase().startsWith("minimax") && type === "t2v")
            return {
                model: "MiniMax",
                user_args: [
                    { root: "3", name: "prompt", value: body.prompt || "" },
                    { root: "3", name: "model", value: "video-01" },
                ],
            }
        else if (body.model === "KLing-v1-6" && type === "t2v")
            return {
                model: "KLing-v1-6",
                user_args: [
                    { root: "2", name: "prompt", value: body.prompt || "" },
                    { root: "999", name: "text", value: "kling_text_to_video_" },
                    { root: "2", name: "aspect_ratio", value: ratio },
                ],
            }
        else if (body.model === "Wan2.1" && type === "t2v")
            return {
                model: "Wan2.1",
                user_args: [
                    { root: "1", name: "text", value: body.prompt || "" },
                    { root: "5", name: "width", value: width },
                    { root: "5", name: "height", value: height },
                    { root: "999", name: "filename_prefix", value: "wan21_text_to_video_" },
                ],
            }
        else if (body.model.toLowerCase() === "trio-one" && type === "t2v")
            return {
                model: "HunYuan",
                user_args: [
                    { root: "1", name: "width", value: width },
                    { root: "1", name: "height", value: height },
                    { root: "3", name: "text", value: body.prompt || "" },
                ],
            }
        throw new BadRequestException("no such model")
    }
}
