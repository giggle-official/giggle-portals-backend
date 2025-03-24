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
    CancelGenerateImageRequestDto,
    GenerateImageListDto,
    GenerateImageRequestDto,
    GenerateImageTaskResponseDto,
    GenerateImageStatusDto,
    ReGenerateImageRequestDto,
    TaskGenerateImageDto,
    supportedRatios,
    GenerateImageParamsDto,
    GenerateImageRequestDetailDto,
} from "./generate-image.dto"
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

export const maxPixel = 1920

@Injectable()
export class GenerateImageService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,

        @Inject(forwardRef(() => AssetsService))
        private readonly assetsService: AssetsService,

        @Inject(forwardRef(() => CreditService))
        private readonly creditService: CreditService,

        @Inject(forwardRef(() => UserService))
        private readonly userService: UserService,

        @Inject(forwardRef(() => TaskService))
        private readonly taskService: TaskService,
    ) {}

    private readonly logger = new Logger(GenerateImageService.name)

    async getList(userInfo: UserInfoDTO, take: number = 10): Promise<GenerateImageListDto> {
        const response = await this.prismaService.generate_image_request.findMany({
            where: {
                user: userInfo.usernameShorted,
                current_status: {
                    not: { in: [GenerateImageStatusDto.CANCELLED] },
                },
            },
            select: {
                id: true,
                current_status: true,
                object_key: true,
                from_asset_id: true,
                generate_image_result: {
                    select: {
                        generate_image_detail: {
                            select: {
                                thumbnail: true,
                                object_key: true,
                            },
                            take: 1,
                            orderBy: {
                                created_at: "desc",
                            },
                        },
                    },
                },
            },
            orderBy: {
                created_at: "desc",
            },
            take: take,
        })

        const count = await this.prismaService.generate_image_request.count({
            where: {
                user: userInfo.usernameShorted,
                current_status: { not: { in: [GenerateImageStatusDto.CANCELLED] } },
            },
        })

        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

        const result = await Promise.all(
            response.map(async (item) => {
                let object_key: string | null = null
                let object_url: string | null = null
                if (item.generate_image_result.length > 0) {
                    const key =
                        item.generate_image_result?.[0]?.generate_image_detail?.[0]?.thumbnail ||
                        item.generate_image_result?.[0]?.generate_image_detail?.[0]?.object_key
                    object_key = key
                    object_url = await this.utilitiesService.createS3SignedUrl(key, s3Info)
                }
                return {
                    id: item.id,
                    current_status: item.current_status as GenerateImageStatusDto,
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

    async detail(user: UserInfoDTO, id: number): Promise<GenerateImageRequestDetailDto> {
        const record = await this.prismaService.generate_image_request.findUnique({
            where: {
                id,
                user: user.usernameShorted,
                current_status: { not: { in: [GenerateImageStatusDto.CANCELLED] } },
            },
            include: {
                generate_image_result: {
                    select: {
                        id: true,
                        generate_params: true,
                        current_status: true,
                        created_at: true,
                        updated_at: true,
                        generate_image_detail: true,
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
            current_status: record.current_status as GenerateImageStatusDto,
            progress: 0,
            object_key: record.object_key,
            object_url: await this.utilitiesService.createS3SignedUrl(record.object_key, s3Info),
            type: record.type,
            prompt: record.prompt,
            generate_params: record.generate_params as any as GenerateImageParamsDto,
            generate_image_result: await Promise.all(
                record.generate_image_result.map(async (item: any) => ({
                    id: item.id,
                    created_at: item.created_at,
                    updated_at: item.updated_at,
                    current_status: item.current_status as GenerateImageStatusDto,
                    generate_params: item.generate_params as any as GenerateImageParamsDto,
                    generate_image_detail: await Promise.all(
                        item.generate_image_detail.map(async (detail) => ({
                            id: detail.id,
                            thumbnail: detail?.thumbnail || detail.object_key,
                            thumbnail_url: detail?.thumbnail
                                ? await this.utilitiesService.createS3SignedUrl(detail.thumbnail, s3Info)
                                : await this.utilitiesService.createS3SignedUrl(detail.object_key, s3Info),
                            object_key: detail.object_key,
                            object_url: await this.utilitiesService.createS3SignedUrl(detail.object_key, s3Info),
                            download_url: await this.utilitiesService.createS3SignedUrl(
                                detail.object_key,
                                s3Info,
                                true,
                            ),
                        })),
                    ),
                })),
            ),
        }
    }

    async createGenerateImageTask(
        user: UserInfoDTO,
        body: GenerateImageRequestDto,
    ): Promise<{
        request: TaskCreateDto
        task_id: string
        generate_id: string
        type: "image" | "text"
        asset: AssetDetailDto | null
        params: TaskGenerateImageDto
    }> {
        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)
        let generateType: "image" | "text" = "image"
        let params: TaskGenerateImageDto
        let asset: AssetDetailDto | null = null
        if (body.from_asset_id) {
            generateType = "image"
            //this indicate user want to generate image from another image
            asset = await this.assetsService.getAsset(user, body.from_asset_id)
            if (!asset) throw new NotFoundException("Asset not found")
            if (asset.type !== "image") throw new BadRequestException("Asset is not an image")
            const { width, height } = await this.zoomOutPixelByRation(
                { width: asset.asset_info?.width || 1280, height: asset.asset_info?.height || 720 },
                maxPixel,
            )
            params = {
                bucket: s3Info.s3_bucket,
                file_name: asset.path,
                user_args: [
                    { root: "12", name: "width", value: width },
                    { root: "12", name: "height", value: height },
                    { root: "5", name: "t5xxl", value: body.prompt || "" },
                ],
                image_cnt: 1,
            }
        } else {
            generateType = "text"
            const { width, height } = await this.getPixelByRatio(body.ratio)
            params = {
                bucket: s3Info.s3_bucket,
                user_args: [
                    { root: "7", name: "width", value: width },
                    { root: "7", name: "height", value: height },
                    { root: "7", name: "batch_size", value: body.count || 1 },
                    { root: "4", name: "t5xxl", value: body.prompt || "" },
                ],
                image_cnt: body.count || 1,
            }
        }

        const generateId = uuidv4()
        const createTaskParam: TaskCreateDto = {
            method: "ImageService.Gen",
            params: [{ ...params, image_class: generateType }],
            id: generateId,
        }
        const task: TaskCreateResponseDto<string> = await this.taskService.taskCreateRequest(createTaskParam)
        if (!task?.result?.task_id) {
            this.logger.error(
                `Failed to create generate image task: ${JSON.stringify(task)}, createParams: ${JSON.stringify(createTaskParam)}`,
            )
            throw new InternalServerErrorException("Failed to create generate image task")
        }

        return {
            generate_id: generateId,
            type: generateType,
            request: createTaskParam,
            task_id: task.result.task_id,
            asset: asset,
            params: params,
        }
    }

    async create(user: UserInfoDTO, body: GenerateImageRequestDto) {
        if (!body.from_asset_id && !body.prompt) {
            throw new BadRequestException("Either from_asset_id or prompt must be provided")
        }

        if (!body.from_asset_id && !body.ratio) {
            throw new BadRequestException("Either from_asset_id or ratio must be provided")
        }

        const count = body.from_asset_id ? 1 : body.count
        const userProfile = await this.userService.getProfile(user)
        const consumeCredit = this.creditService.computeGenerateCredit(
            userProfile.subscription_info,
            count,
            "generate_image",
        )
        if (userProfile.credit < consumeCredit) throw new BadRequestException("insufficient credits")

        const task = await this.createGenerateImageTask(user, {
            prompt: body.prompt,
            ratio: body.ratio,
            count: body.count,
            from_asset_id: body.from_asset_id,
        })

        const result = await this.prismaService.$transaction(async (tx) => {
            const createdRequest = await tx.generate_image_request.create({
                data: {
                    user: user.usernameShorted,
                    from_asset_id: body.from_asset_id || undefined,
                    object_key: task.type === "image" ? task.asset?.path : undefined,
                    type: task.type,
                    prompt: body.prompt || undefined,
                    generate_params: { ratio: body.ratio || null },
                    current_status: GenerateImageStatusDto.PROCESSING,
                },
            })

            const imageResult = await tx.generate_image_result.create({
                data: {
                    request_id: createdRequest.id,
                    generate_task_id: task.task_id,
                    current_status: GenerateImageStatusDto.PROCESSING,
                    generate_params: {
                        ratio: body?.ratio || null,
                        width: task.params.user_args.find((item) => item.name === "width")?.value || null,
                        height: task.params.user_args.find((item) => item.name === "height")?.value || null,
                        prompt: body?.prompt || null,
                        batch_size: task.params.user_args.find((item) => item.name === "batch_size")?.value || null,
                    },
                    task_request: task.request as any,
                },
            })
            return { createdRequest, imageResult }
        })

        //pending credit
        await this.creditService.pendingCredit(
            user,
            consumeCredit,
            this.creditService.generateRelatedId(result.imageResult.id, "generate_image"),
        )
        return this.detail(user, result.createdRequest.id)
    }

    async reGenerate(user: UserInfoDTO, body: ReGenerateImageRequestDto) {
        const record = await this.prismaService.generate_image_request.findUnique({
            where: {
                id: body.id,
                user: user.usernameShorted,
                current_status: { not: { in: [GenerateImageStatusDto.CANCELLED] } },
            },
        })
        if (!record) throw new NotFoundException("Generate image not found")

        const count = record.from_asset_id ? 1 : body.count
        const userProfile = await this.userService.getProfile(user)
        const consumeCredit = this.creditService.computeGenerateCredit(
            userProfile.subscription_info,
            count,
            "generate_image",
        )
        if (userProfile.credit < consumeCredit) throw new BadRequestException("insufficient credits")

        const task = await this.createGenerateImageTask(user, {
            prompt: body.prompt,
            ratio: body.ratio,
            count: body.count,
            from_asset_id: record.from_asset_id,
        })

        const result = await this.prismaService.$transaction(async (tx) => {
            const updated = await tx.generate_image_request.update({
                where: { id: body.id },
                data: {
                    current_status: GenerateImageStatusDto.PROCESSING,
                    prompt: body.prompt || undefined,
                    generate_params: { ratio: body.ratio || null },
                },
            })
            const imageResult = await tx.generate_image_result.create({
                data: {
                    request_id: updated.id,
                    generate_task_id: task.task_id,
                    current_status: GenerateImageStatusDto.PROCESSING,
                    generate_params: {
                        ratio: body.ratio || null,
                        width: task.params.user_args.find((item) => item.name === "width")?.value || null,
                        height: task.params.user_args.find((item) => item.name === "height")?.value || null,
                        prompt: body?.prompt || null,
                        batch_size: task.params.user_args.find((item) => item.name === "batch_size")?.value || null,
                    },
                    task_request: task.request as any,
                },
            })
            return { updated, imageResult }
        })
        //pending credit
        await this.creditService.pendingCredit(
            user,
            consumeCredit,
            this.creditService.generateRelatedId(result.imageResult.id, "generate_image"),
        )

        return this.detail(user, result.updated.id)
    }

    async getPixelByRatio(ratio: string): Promise<{ width: number; height: number }> {
        const ratioObj = supportedRatios[ratio]
        if (!ratioObj) return supportedRatios["16:9"] //default to 16:9
        return { width: ratioObj.width, height: ratioObj.height }
    }

    async checkImageGenerateTaskStatus() {
        this.logger.log(`Checking generate image task status`)
        const pendingTasks = await this.prismaService.generate_image_result.findMany({
            where: {
                current_status: GenerateImageStatusDto.PROCESSING,
            },
            include: {
                generate_image_request: {
                    include: {
                        user_info: true,
                    },
                },
            },
        })
        this.logger.log(`Found ${pendingTasks.length} generate image pending tasks`)

        for (const task of pendingTasks) {
            try {
                const taskQuery: TaskQueryDto = {
                    method: "QueryService.Task",
                    params: [
                        {
                            task_id: task.generate_task_id,
                            task_type: "ImageGenerate",
                            user_id: task.generate_image_request.user_info.email,
                        },
                    ],
                    id: uuidv4(),
                }
                const response: TaskQueryResponseDto<TaskQueryResponseResult> =
                    await this.taskService.taskQueryRequest(taskQuery)
                if (response.result.status === 2) {
                    const result = JSON.parse(response.result.result as string) as GenerateImageTaskResponseDto
                    //create asset
                    for (const item of result) {
                        //create image record
                        const asset = await this.assetsService.uploadedByTask(
                            { usernameShorted: task.generate_image_request.user_info.username_in_be },
                            {
                                object_key: item,
                                name: item,
                                category: "exports",
                                source_video: task.request_id,
                                exported_by: "generate-image",
                                task_id: task.generate_task_id,
                            },
                        )

                        await this.prismaService.generate_image_detail.create({
                            data: {
                                result_id: task.id,
                                object_key: item,
                                thumbnail: asset?.thumbnail || item,
                                to_asset_id: asset.id,
                                updated_at: new Date(),
                            },
                        })
                    }
                    //update generate_video_result
                    await this.prismaService.generate_image_result.update({
                        where: { id: task.id },
                        data: {
                            current_status: GenerateImageStatusDto.COMPLETED,
                            task_response: response as any,
                        },
                    })

                    //complete credit
                    const relatedIds = this.creditService.generateRelatedId(task.id, "generate_image")
                    await this.creditService.completeCredit(relatedIds)
                } else if (response.result.status === 3) {
                    this.logger.error(
                        `Generate image task ${task.generate_task_id} failed, response: ${JSON.stringify(response)}`,
                    )
                    //refund credit
                    const relatedIds = this.creditService.generateRelatedId(task.id, "generate_image")
                    await this.creditService.refundCredit(relatedIds)

                    await this.prismaService.generate_image_result.update({
                        where: { id: task.id },
                        data: {
                            current_status: GenerateImageStatusDto.FAILED,
                            task_response: response as any,
                            updated_at: new Date(),
                        },
                    })
                }
            } catch (error) {
                this.logger.error(
                    `Error checking generate image task status for task ${task.generate_task_id}: ${error.message}`,
                    error,
                )
                continue
            }
        }

        //check status
        const allSubResult = await this.prismaService.generate_image_request.findMany({
            include: {
                generate_image_result: true,
            },
        })
        await Promise.all(
            allSubResult.map(async (item) => {
                const allCompleted = item.generate_image_result.every(
                    (item) => item.current_status !== GenerateImageStatusDto.PROCESSING,
                )
                const hasFailed = item.generate_image_result.some(
                    (item) => item.current_status === GenerateImageStatusDto.FAILED,
                )
                let status: GenerateImageStatusDto
                if (allCompleted) {
                    status = hasFailed ? GenerateImageStatusDto.FAILED : GenerateImageStatusDto.COMPLETED
                } else {
                    status = GenerateImageStatusDto.PROCESSING
                }
                await this.prismaService.generate_image_request.update({
                    where: { id: item.id },
                    data: { current_status: status },
                })
            }),
        )

        this.logger.log("Generate image task status check completed")
    }

    async getSupportedRatios() {
        return Object.keys(supportedRatios).map((ratio) => ({
            ratio: ratio,
            width: supportedRatios[ratio].width,
            height: supportedRatios[ratio].height,
        }))
    }

    async zoomOutPixelByRation(
        { width, height }: { width: number; height: number },
        maxPixel: number,
    ): Promise<{ width: number; height: number }> {
        if (width > maxPixel || height > maxPixel) {
            const ratio = width / height
            return ratio >= 1
                ? { width: maxPixel, height: Math.floor(maxPixel / ratio) }
                : { width: Math.floor(maxPixel * ratio), height: maxPixel }
        }
        return { width, height }
    }
}
