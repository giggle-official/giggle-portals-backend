import {
    Inject,
    forwardRef,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
    BadRequestException,
} from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import {
    FaceExtractedDto,
    FaceExtractTaskResponseDto,
    FaceSwapCancelParamsDto,
    FaceSwapCreateDto,
    FaceSwapDetailDto,
    FaceSwapListDto,
    FaceSwapReExtractDto,
    FaceSwapRemoveFaceDto,
    FaceSwapRequestDto,
    FaceSwapReSwapDto,
    FaceSwapRetryDto,
    FaceSwapStatus,
    FaceSwapTaskResponseDto,
    TaskFaceExtractDto,
} from "./face-swap.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { UtilitiesService } from "src/common/utilities.service"
import { AssetsService } from "src/assets/assets.service"
import { TaskService } from "src/task/task.service"
import {
    TaskCreateDto,
    TaskCreateResponseDto,
    TaskQueryDto,
    TaskQueryResponseDto,
    TaskQueryResponseResult,
} from "src/task/task.dto"
import { v4 as uuidv4 } from "uuid"
import { ASSETS_MAX_TAKE } from "src/assets/assets.dto"
import { S3InfoDto } from "src/common/utilities.service"
import { UserService } from "src/user/user.service"
import { CreditService } from "src/credit/credit.service"

@Injectable()
export class FaceSwapService {
    constructor(
        private readonly prismaService: PrismaService,
        private readonly utilitiesService: UtilitiesService,
        private readonly userService: UserService,
        private readonly creditService: CreditService,

        @Inject(forwardRef(() => AssetsService))
        private readonly assetsService: AssetsService,

        @Inject(forwardRef(() => TaskService))
        private readonly taskService: TaskService,
    ) {}

    private readonly logger = new Logger(FaceSwapService.name)

    async getList(userInfo: UserInfoDTO, take: number = 10): Promise<FaceSwapListDto> {
        const response = await this.prismaService.face_swap_videos.findMany({
            where: {
                user: userInfo.usernameShorted,
                status: {
                    not: { in: [FaceSwapStatus.CANCELLED] },
                },
            },
            select: {
                id: true,
                name: true,
                status: true,
                thumbnail: true,
            },
            orderBy: {
                created_at: "desc",
            },
            take: take,
        })
        const count = await this.prismaService.face_swap_videos.count({
            where: { user: userInfo.usernameShorted, status: { not: { in: [FaceSwapStatus.CANCELLED] } } },
        })

        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

        const result = await Promise.all(
            response.map(async (item) => ({
                id: item.id,
                name: item.name,
                status: item.status as FaceSwapStatus,
                thumbnail: item.thumbnail,
                thumbnail_url: item.thumbnail
                    ? await this.utilitiesService.createS3SignedUrl(item.thumbnail, s3Info)
                    : null,
            })),
        )

        return {
            total: count,
            data: result,
        }
    }

    async create(user: UserInfoDTO, data: FaceSwapCreateDto) {
        const fromAsset = await this.assetsService.getAsset(user, data.from_asset_id)
        if (!fromAsset) throw new NotFoundException("From asset not found")

        //copy object key
        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)
        const s3Client = await this.utilitiesService.getS3Client(user.usernameShorted)
        const newFileName = await this.assetsService.getAssetKey(user, fromAsset.path)

        await s3Client
            .copyObject({
                Bucket: s3Info.s3_bucket,
                CopySource: `${s3Info.s3_bucket}/${fromAsset.path}`,
                Key: newFileName,
            })
            .promise()

        const record = await this.prismaService.face_swap_videos.create({
            data: {
                user: user.usernameShorted,
                name: fromAsset.name || "",
                object_key: newFileName || "",
                status: FaceSwapStatus.UPLOADED,
                video_info: (fromAsset.asset_info as any)?.videoInfo || {},
                thumbnail: fromAsset.thumbnail || "",
                from_asset_id: fromAsset.id,
                created_at: new Date(),
                updated_at: new Date(),
            },
        })

        const extractDefaultParams = {
            face_score: 0.8,
            face_distance: 0.6,
        }
        //create extracting task
        const user_args = [
            {
                root: "1",
                name: "face_score",
                value: extractDefaultParams.face_score,
            },
            {
                root: "1",
                name: "face_distance",
                value: extractDefaultParams.face_distance,
            },
        ]
        const taskId = await this._createExtractingTask(newFileName, s3Info, user_args)

        await this.prismaService.face_swap_videos.update({
            where: { id: record.id },
            data: {
                extract_task_id: taskId,
                status: FaceSwapStatus.EXTRACTING,
                extracting_params: extractDefaultParams,
            },
        })

        return this.detail(user, record.id)
    }

    private async _createExtractingTask(
        file_name: string,
        s3Info: S3InfoDto,
        user_args: TaskFaceExtractDto["user_args"],
    ): Promise<string> {
        const createTaskParam: TaskCreateDto = {
            method: "FaceService.Detect",
            params: [{ bucket: s3Info.s3_bucket, file_name, user_args }],
            id: uuidv4(),
        }
        const task: TaskCreateResponseDto = await this.taskService.taskCreateRequest(createTaskParam)
        if (!task?.result?.task_id) {
            this.logger.error(
                `Failed to create extracting task: ${JSON.stringify(task)}, createParams: ${JSON.stringify(createTaskParam)}`,
            )
            throw new InternalServerErrorException("Failed to create extracting task")
        }
        return task.result.task_id
    }

    async detail(user: UserInfoDTO, id: number): Promise<FaceSwapDetailDto> {
        const record = await this.prismaService.face_swap_videos.findUnique({
            where: { id, user: user.usernameShorted },
            select: {
                id: true,
                name: true,
                status: true,
                thumbnail: true,
                created_at: true,
                updated_at: true,
                object_key: true,
                video_info: true,
                face_extracted: {
                    select: {
                        id: true,
                        recognition_face_key: true,
                        target_face_key: true,
                    },
                },
            },
        })
        if (!record) throw new NotFoundException("Face swap video not found")

        const s3Info = await this.utilitiesService.getS3Info(user.usernameShorted)

        const faceExtracted: FaceExtractedDto[] = []

        if (record.face_extracted.length > 0) {
            await Promise.all(
                record.face_extracted.map(async (face: any) => {
                    faceExtracted.push({
                        id: face.id,
                        recognition_face_key: face.recognition_face_key,
                        recognition_face_url: await this.utilitiesService.createS3SignedUrl(
                            face.recognition_face_key,
                            s3Info,
                        ),
                        target_face_key: face.target_face_key,
                        target_face_url: await this.utilitiesService.createS3SignedUrl(face.target_face_key, s3Info),
                    })
                }),
            )
        }

        return {
            ...record,
            queue_position: 0,
            status: record.status as FaceSwapStatus,
            thumbnail_url: await this.utilitiesService.createS3SignedUrl(record.thumbnail, s3Info),
            object_video_url: await this.utilitiesService.createS3SignedUrl(record.object_key, s3Info),
            face_extracted: faceExtracted,
            exported_assets: await this.assetsService.getAssets(user, {
                type: "video",
                category: "exports",
                exported_by: "face-swap",
                source_video: record.id,
                take: ASSETS_MAX_TAKE,
                skip: 0,
            }),
        }
    }

    async cancelVideo(userInfo: UserInfoDTO, body: FaceSwapCancelParamsDto) {
        try {
            const video = await this.prismaService.face_swap_videos.findFirst({
                where: {
                    id: body.id,
                    user: userInfo.usernameShorted,
                },
            })
            if (!video) {
                throw new Error("Video not found or you do not have permission to access it.")
            }
            const currentStatus = video.status as FaceSwapStatus

            if (currentStatus === FaceSwapStatus.SWAPPING) {
                throw new Error("Cannot cancel video while swapping")
            }

            return await this.prismaService.$transaction(async (prisma) => {
                await prisma.face_swap_extracted.deleteMany({
                    where: {
                        face_swap_video_id: body.id,
                    },
                })
                await prisma.face_swap_videos.update({
                    where: { id: body.id },
                    data: {
                        status: FaceSwapStatus.CANCELLED,
                    },
                })
                const relatedIds = this.creditService.generateRelatedId(body.id, "face_swap")
                await this.creditService.refundCredit(relatedIds)
                return this.detail(userInfo, body.id)
            })
        } catch (error) {
            this.logger.error(
                `Error in cancel face swap video: ${error.message}, request body: ${JSON.stringify(body)}, userInfo: ${JSON.stringify(userInfo)}`,
                error.stack,
            )
            throw new InternalServerErrorException("Failed to cancel face swap video: " + error.message)
        }
    }

    async reExtractFace(userInfo: UserInfoDTO, body: FaceSwapReExtractDto) {
        const video = await this.prismaService.face_swap_videos.findFirst({
            where: { id: body.id, user: userInfo.usernameShorted },
            include: {
                face_extracted: true,
            },
        })
        if (!video) throw new NotFoundException("Face swap video not found")

        if (video.status === FaceSwapStatus.EXTRACTING) {
            throw new BadRequestException("Face extracting, please wait for it to finish")
        }
        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
        const user_args = [
            {
                root: "1",
                name: "face_score",
                value: body.extracting_params.face_score,
            },
            {
                root: "1",
                name: "face_distance",
                value: body.extracting_params.face_distance,
            },
        ]
        const taskId = await this._createExtractingTask(video.object_key, s3Info, user_args)
        await this.prismaService.face_swap_videos.update({
            where: { id: body.id },
            data: {
                extract_task_id: taskId,
                status: FaceSwapStatus.EXTRACTING,
                extracting_params: body.extracting_params as any,
                updated_at: new Date(),
            },
        })
        return this.detail(userInfo, body.id)
    }

    async checkExtractTaskStatus(limit: number = 100) {
        this.logger.log("Checking face extracting task status")
        const pendingTasks = await this.prismaService.face_swap_videos.findMany({
            where: {
                status: FaceSwapStatus.EXTRACTING,
            },
            include: {
                user_info: true,
            },
            take: limit,
        })

        this.logger.log(`Found ${pendingTasks.length} face extracting pending tasks`)

        for (const faceSwapVideo of pendingTasks) {
            try {
                const taskQuery: TaskQueryDto = {
                    method: "QueryService.Task",
                    params: [
                        {
                            task_id: faceSwapVideo.extract_task_id,
                            task_type: "FaceDetect",
                            user_id: faceSwapVideo.user_info.email,
                        },
                    ],
                    id: uuidv4(),
                }

                const response: TaskQueryResponseDto<TaskQueryResponseResult> =
                    await this.taskService.taskQueryRequest(taskQuery)
                this.logger.log(
                    `Task query response for task ${faceSwapVideo.extract_task_id}:`,
                    JSON.stringify(response, null, 2),
                )

                if (response.result.status === 2) {
                    // Start a Prisma transaction
                    await this.prismaService.$transaction(async (prisma) => {
                        await prisma.face_swap_extracted.deleteMany({
                            where: { face_swap_video_id: faceSwapVideo.id },
                        })
                        // Create split records for each split part
                        const extractedFaces = JSON.parse(
                            response.result.result as string,
                        ) as FaceExtractTaskResponseDto
                        for (let i = 0; i < extractedFaces.length; i++) {
                            await prisma.face_swap_extracted.create({
                                data: {
                                    face_swap_video_id: faceSwapVideo.id,
                                    recognition_face_key: extractedFaces[i],
                                    created_at: new Date(),
                                    updated_at: new Date(),
                                },
                            })
                        }
                        await prisma.face_swap_videos.update({
                            where: { id: faceSwapVideo.id },
                            data: {
                                status: FaceSwapStatus.EXTRACTED,
                            },
                        })
                    })
                } else if (response.result.status === 3) {
                    // Failed
                    this.logger.error(
                        `Face extracting task ${faceSwapVideo.extract_task_id} failed, response: ${JSON.stringify(response)}`,
                    )
                    await this.prismaService.face_swap_videos.update({
                        where: { id: faceSwapVideo.id },
                        data: {
                            status: FaceSwapStatus.FAILED,
                        },
                    })
                }
            } catch (error) {
                this.logger.error(
                    `Error checking face extracting task status for task ${faceSwapVideo.extract_task_id}: ${error.message}`,
                    error,
                )
                continue
            }
        }
        this.logger.log("Face extracting task status check completed")
    }

    async checkSwapTaskStatus(limit: number = 100) {
        this.logger.log("Checking face swapping task status")
        const pendingTasks = await this.prismaService.face_swap_videos.findMany({
            where: {
                status: FaceSwapStatus.SWAPPING,
            },
            take: limit,
        })
        this.logger.log(`Found ${pendingTasks.length} face swapping pending tasks`)

        for (const faceSwapVideo of pendingTasks) {
            try {
                const taskQuery: TaskQueryDto = {
                    method: "QueryService.Task",
                    params: [
                        { task_id: faceSwapVideo.swapping_task_id, task_type: "FaceSwap", user_id: faceSwapVideo.user },
                    ],
                    id: uuidv4(),
                }
                const response: TaskQueryResponseDto<TaskQueryResponseResult> =
                    await this.taskService.taskQueryRequest(taskQuery)
                this.logger.log(
                    `Task query response for task ${faceSwapVideo.swapping_task_id}:`,
                    JSON.stringify(response, null, 2),
                )
                if (response.result.status === 2) {
                    const result = response.result.result as FaceSwapTaskResponseDto
                    await this.prismaService.face_swap_videos.update({
                        where: { id: faceSwapVideo.id },
                        data: {
                            status: FaceSwapStatus.SWAPPED,
                            swapped_result_key: result,
                            updated_at: new Date(),
                        },
                    })
                    //create asset
                    const asset = await this.assetsService.uploadedByTask(
                        { usernameShorted: faceSwapVideo.user },
                        {
                            object_key: result,
                            name: result,
                            category: "exports",
                            source_video: faceSwapVideo.id,
                            exported_by: "face-swap",
                            task_id: faceSwapVideo.swapping_task_id,
                        },
                    )
                }
                if (response.result.status === 3) {
                    this.logger.error(
                        `Face swapping task ${faceSwapVideo.swapping_task_id} failed, response: ${JSON.stringify(response)}`,
                    )
                    await this.prismaService.face_swap_videos.update({
                        where: { id: faceSwapVideo.id },
                        data: { status: FaceSwapStatus.FAILED },
                    })
                }
            } catch (error) {
                this.logger.error(
                    `Error checking face swapping task status for task ${faceSwapVideo.swapping_task_id}: ${error.message}`,
                    error,
                )
                continue
            }
        }
        this.logger.log("Face swapping task status check completed")
    }

    async retry(userInfo: UserInfoDTO, body: FaceSwapRetryDto) {
        const video = await this.prismaService.face_swap_videos.findFirst({
            where: { id: body.id, user: userInfo.usernameShorted },
        })
        if (!video) throw new NotFoundException("Face swap video not found")

        const extractedFaces = await this.prismaService.face_swap_extracted.findMany({
            where: { face_swap_video_id: video.id },
        })

        await this.prismaService.face_swap_videos.update({
            where: { id: body.id },
            data: {
                status: extractedFaces.length > 0 ? FaceSwapStatus.EXTRACTED : FaceSwapStatus.UPLOADED,
                updated_at: new Date(),
            },
        })

        return await this.detail(userInfo, body.id)
    }

    async swapFace(userInfo: UserInfoDTO, body: FaceSwapRequestDto) {
        const video = await this.prismaService.face_swap_videos.findFirst({
            where: { id: body.video_id, user: userInfo.usernameShorted },
        })
        if (!video) throw new NotFoundException("Face swap video not found")

        const videoInfo = video.video_info as any
        const videoSeconds = videoInfo?.duration || 0
        if (!videoSeconds) throw new BadRequestException("Video info error")

        const userProfile = await this.userService.getProfile(userInfo)
        const consumeCredit = this.creditService.computeGenerateCredit(
            userProfile.subscription_info,
            videoSeconds,
            "face_swap",
        )

        if (userProfile.credit < consumeCredit) throw new BadRequestException("insufficient credits")

        const imageList = []
        await this.prismaService.$transaction(async (prisma) => {
            for (const item of body.swap_params) {
                const face = await prisma.face_swap_extracted.findFirst({
                    where: { id: item.face_id, face_swap_video_id: video.id },
                })
                if (!face) throw new NotFoundException("Face swap video not found")
                const targetFace = await prisma.face_swap_extracted.update({
                    where: { id: item.face_id },
                    data: {
                        target_face_key: item.target_face_key,
                        updated_at: new Date(),
                    },
                })
                if (face.recognition_face_key && targetFace.target_face_key) {
                    imageList.push({
                        reference_img: face.recognition_face_key,
                        source_img: targetFace.target_face_key,
                    })
                }
            }
        })

        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

        if (imageList.length === 0) throw new BadRequestException("You must upload at least one face")

        const createTaskParam: TaskCreateDto = {
            method: "FaceService.Swap",
            params: [{ bucket: s3Info.s3_bucket, file_name: video.object_key, image_list: imageList }],
            id: uuidv4(),
        }
        const task: TaskCreateResponseDto = await this.taskService.taskCreateRequest(createTaskParam)
        if (!task?.result?.task_id) {
            this.logger.error(
                `Failed to create swapping task: ${JSON.stringify(task)}, createParams: ${JSON.stringify(createTaskParam)}`,
            )
            throw new InternalServerErrorException("Failed to create swapping task")
        }

        await this.prismaService.face_swap_videos.update({
            where: { id: video.id },
            data: {
                status: FaceSwapStatus.SWAPPING,
                swapping_task_id: task.result.task_id,
            },
        })

        await this.creditService.pendingCredit(
            userInfo,
            consumeCredit,
            this.creditService.generateRelatedId(video.id, "face_swap"),
        )

        return this.detail(userInfo, video.id)
    }

    async reSwap(userInfo: UserInfoDTO, body: FaceSwapReSwapDto) {
        const video = await this.prismaService.face_swap_videos.findFirst({
            where: { id: body.id, user: userInfo.usernameShorted },
        })
        if (!video) throw new NotFoundException("Face swap video not found")

        if (video.status !== FaceSwapStatus.SWAPPED) {
            throw new BadRequestException("you can only re-swap a swapped face swap video")
        }

        await this.prismaService.face_swap_videos.update({
            where: { id: video.id },
            data: {
                status: FaceSwapStatus.EXTRACTED,
                swapped_result_key: null,
                swapping_task_id: null,
                updated_at: new Date(),
            },
        })

        return this.detail(userInfo, video.id)
    }

    async removeFace(userInfo: UserInfoDTO, body: FaceSwapRemoveFaceDto) {
        const face = await this.prismaService.face_swap_extracted.findFirst({
            where: {
                id: body.id,
            },
            include: {
                face_swap_video_info: {
                    where: {
                        user: userInfo.usernameShorted,
                    },
                },
            },
        })
        if (!face || !face.face_swap_video_info) throw new NotFoundException("Face not found")

        await this.prismaService.face_swap_extracted.update({
            where: { id: body.id },
            data: {
                target_face_key: null,
                updated_at: new Date(),
            },
        })

        return this.detail(userInfo, face.face_swap_video_info.id)
    }
}
