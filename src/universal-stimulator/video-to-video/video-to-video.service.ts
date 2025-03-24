import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    Logger,
    NotFoundException,
} from "@nestjs/common"
import {
    SlicedVideoStatus,
    UniversalStimulatorVideo,
    UniversalStimulatorVideoList,
    VideoCancelParamsDto,
    VideoDetailDto,
    VideoGenerateParamsDto,
    VideoProcessStep,
    VideoReGenerateParamsDto,
    VideoRetryParamsDto,
    VideoStopGenerateParamsDto,
} from "./video-to-video.dto"

import {
    VideoSplitDto,
    VideoSplitTaskResponseDto,
    VideoStopGenerateDto,
    VideoInfoTaskResponseDto,
    VideoConcatDto,
    VideoConvertDto,
    VideoFinishDto,
    TaskCreateDto,
    TaskQueryDto,
    TaskQueryResponseDto,
    TaskQueryResponseResult,
} from "src/task/task.dto"
import { v4 } from "uuid"
import { UserInfoDTO } from "src/user/user.controller"
import { PrismaService } from "src/common/prisma.service"
import { universal_stimulator_videos } from "@prisma/client"
import { UserService } from "src/user/user.service"
import { CreditService } from "src/credit/credit.service"
import { S3 } from "aws-sdk"
import { UtilitiesService } from "src/common/utilities.service"
import { TaskService } from "src/task/task.service"
import { AssetsService } from "src/assets/assets.service"
import { ASSETS_MAX_TAKE, UploadedDto } from "src/assets/assets.dto"
import { S3InfoDto } from "src/common/utilities.service"

@Injectable()
export class VideoToVideoService {
    private readonly taskUrl: string
    private readonly logger = new Logger(VideoToVideoService.name)
    constructor(
        private readonly prismaService: PrismaService,
        private readonly userService: UserService,
        private readonly creditService: CreditService,
        private readonly utilitiesService: UtilitiesService,
        @Inject(forwardRef(() => TaskService))
        private readonly taskService: TaskService,
        @Inject(forwardRef(() => AssetsService))
        private readonly assetsService: AssetsService,
    ) {
        this.taskUrl = process.env.UNIVERSAL_STIMULATOR_TASK_URL
        if (!this.taskUrl) {
            throw new Error("UNIVERSAL_STIMULATOR_TASK_URL is not defined in the environment variables")
        }
    }

    async getVideoList(userInfo: UserInfoDTO, take: number = 10): Promise<UniversalStimulatorVideoList> {
        const response = await this.prismaService.universal_stimulator_videos.findMany({
            where: {
                user: userInfo.usernameShorted,
                current_status: {
                    not: { in: [VideoProcessStep.CANCELLED] },
                },
            },
            include: {
                sliced_videos: true,
            },
            orderBy: {
                created_at: "desc",
            },
            take: take,
        })
        const count = await this.prismaService.universal_stimulator_videos.count({
            where: { user: userInfo.usernameShorted, current_status: { not: { in: [VideoProcessStep.CANCELLED] } } },
        })

        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

        const data: UniversalStimulatorVideo[] = await Promise.all(
            response.map(async (video) => {
                const videoInfo = video.video_info as any
                const generateParams = video.generate_params as any
                const convertProgress = Math.ceil(
                    (video.sliced_videos.filter((v) => v.generate_status === SlicedVideoStatus.COMPLETED).length /
                        video.sliced_videos.length) *
                        100,
                )
                return {
                    id: video.id,
                    name: video.name,
                    thumbnail: video.thumbnail
                        ? await this.utilitiesService.createS3SignedUrl(video.thumbnail, s3Info)
                        : "",
                    current_step: video.current_status as VideoProcessStep,
                    created_at: video.created_at,
                    video_info: {
                        width: videoInfo?.width || 0,
                        height: videoInfo?.height || 0,
                        duration: videoInfo?.duration || 0,
                    },
                    generate_params: {
                        preset: generateParams?.preset || "",
                        seed: generateParams?.seed || 0,
                        prompt: generateParams?.prompt || "",
                        total_strength: generateParams?.total_strength || 0,
                    },
                    original_video_url: await this.utilitiesService.createS3SignedUrl(video.name, s3Info),
                    generated_video_url: video.concat_path
                        ? await this.utilitiesService.createS3SignedUrl(video.concat_path, s3Info)
                        : "",
                    generated_video_download_url: video.concat_path
                        ? await this.utilitiesService.createS3SignedUrl(video.concat_path, s3Info, true)
                        : "",
                    queue_position: await this.getVideoQueuePosition(video.id),
                    convert_progress: convertProgress,
                }
            }),
        )
        return {
            total: count,
            data: data,
        }
    }

    async createFromAsset(userInfo: UserInfoDTO, assetId: number) {
        const asset = await this.assetsService.getAsset(userInfo, assetId)
        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
        const s3Client = await this.utilitiesService.getS3Client(userInfo.usernameShorted)
        const newFileName = await this.assetsService.getAssetKey(userInfo, asset.path)

        await s3Client
            .copyObject({
                Bucket: s3Info.s3_bucket,
                CopySource: `${s3Info.s3_bucket}/${asset.path}`,
                Key: newFileName,
            })
            .promise()

        return await this.prismaService.universal_stimulator_videos.create({
            data: {
                user: userInfo.usernameShorted,
                name: newFileName,
                current_status: VideoProcessStep.UPLOADED,
                video_info: asset.asset_info?.videoInfo || {},
                video_info_task_id: null,
                thumbnail: asset.thumbnail,
                created_at: new Date(),
                updated_at: new Date(),
            },
        })
    }

    async retryVideo(userInfo: UserInfoDTO, body: VideoRetryParamsDto) {
        try {
            const video = await this.prismaService.universal_stimulator_videos.findUnique({
                where: { id: body.video_id, user: userInfo.usernameShorted },
                include: {
                    sliced_videos: true,
                },
            })
            if (!video) {
                throw new NotFoundException("Video not found")
            }

            if (video.current_status !== VideoProcessStep.FAILED) {
                throw new BadRequestException("Video can not be retried at this time.")
            }

            const allSlicedVideosCompleted = video.sliced_videos.every(
                (sv) => sv.generate_status === SlicedVideoStatus.COMPLETED,
            )
            if (video.sliced_videos.length === 0) {
                await this.prismaService.universal_stimulator_videos.update({
                    where: { id: video.id },
                    data: { current_status: VideoProcessStep.UPLOADED },
                })
                const splitParams = video.generate_params as any as VideoSplitDto
                await this._submitSplitTask(splitParams)
            } else if (allSlicedVideosCompleted) {
                await this.prismaService.universal_stimulator_videos.update({
                    where: { id: video.id },
                    data: { current_status: VideoProcessStep.CONVERTED },
                })
                await this._mergeVideo(video.id)
            } else {
                /*await this.prismaService.universal_stimulator_videos.update({
                    where: { id: video.id },
                    data: { current_status: VideoProcessStep.SLICED },
                })*/
                await this._submitGenerateTask(video.id)
            }
            return {}
        } catch (error) {
            throw new InternalServerErrorException("Failed to retry video")
        }
    }

    async newVideoUploaded(userInfo: UserInfoDTO, body: UploadedDto) {
        try {
            const newVideoProcessResult = await this.assetsService.uploaded(userInfo, body)
            const videoInfo = newVideoProcessResult.asset_info?.videoInfo as any
            if (!videoInfo) {
                throw new Error("Video info not found")
            }
            const videoInfoTaskId = newVideoProcessResult.asset_info?.videoInfoTaskId || null
            return await this.prismaService.universal_stimulator_videos.create({
                data: {
                    user: userInfo.usernameShorted,
                    name: body.object_key,
                    current_status: VideoProcessStep.UPLOADED,
                    video_info: videoInfo,
                    video_info_task_id: videoInfoTaskId,
                    thumbnail: newVideoProcessResult.thumbnail,
                    created_at: new Date(),
                    updated_at: new Date(),
                },
            })
        } catch (error) {
            this.logger.error("Error processing uploaded video:", error)
            throw new InternalServerErrorException("Failed to process uploaded video")
        }
    }

    async reGeneratevideo(userInfo: UserInfoDTO, body: VideoGenerateParamsDto) {
        try {
            const video = await this.prismaService.universal_stimulator_videos.findFirst({
                where: {
                    id: body.video_id,
                    user: userInfo.usernameShorted,
                },
            })

            if (!video) {
                throw new Error("Video not found or you do not have permission to access it.")
            }

            if (video.current_status !== VideoProcessStep.COMBINED) {
                throw new Error("Video can not be re-generated at this time.")
            }

            const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
            const s3Client = await this.utilitiesService.getS3Client(userInfo.usernameShorted)
            const newFileName = await this.assetsService.getAssetKey(userInfo, video.name)

            await s3Client
                .copyObject({
                    Bucket: s3Info.s3_bucket,
                    CopySource: `${s3Info.s3_bucket}/${video.name}`,
                    Key: newFileName,
                })
                .promise()

            const newVideo = await this.prismaService.universal_stimulator_videos.update({
                where: { id: video.id },
                data: {
                    name: newFileName,
                    current_status: VideoProcessStep.UPLOADED,
                    video_info: video.video_info as any,
                    split_task_id: null,
                    split_status: null,
                    concat_path: null,
                    concat_task_id: null,
                    clean_cache_task_id: null,
                    updated_at: new Date(),
                },
            })

            return await this.generateVideo(userInfo, {
                preset: body.preset,
                prompt: body.prompt,
                seed: body.seed,
                total_strength: body.total_strength,
                video_id: newVideo.id,
                method: body.method,
                convert_seconds: body.convert_seconds,
                split_params: body.split_params,
                resolution: body.resolution,
                enhance_effect: body.enhance_effect,
            } as VideoGenerateParamsDto)
        } catch (error) {
            this.logger.error("Error re-generating video:", error)
            throw new InternalServerErrorException("Failed to re-generate video: " + error.message)
        }
    }

    async getVideoDetail(userInfo: UserInfoDTO, videoId: number): Promise<VideoDetailDto> {
        try {
            const video = await this.prismaService.universal_stimulator_videos.findUnique({
                where: {
                    id: videoId,
                    user: userInfo.usernameShorted,
                    current_status: {
                        not: { in: [VideoProcessStep.CANCELLED] },
                    },
                },
                select: {
                    id: true,
                    name: true,
                    thumbnail: true,
                    current_status: true,
                    created_at: true,
                    video_info: true,
                    generate_params: true,
                },
            })
            if (!video) {
                throw new NotFoundException("Video not found")
            }
            const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

            const videoInfoResponse: VideoDetailDto = {
                ...video,
                signed_url: await this.utilitiesService.createS3SignedUrl(video.name, s3Info),
                current_status: video.current_status as VideoProcessStep,
                video_info: video.video_info as any,
                thumbnail_url: "",
                convert_progress: 0,
                queue_position: await this.getVideoQueuePosition(video.id),
                exported_assets: await this.assetsService.getAssets(userInfo, {
                    type: "video",
                    category: "exports",
                    exported_by: "video-2-video",
                    source_video: video.id,
                    take: ASSETS_MAX_TAKE,
                    skip: 0,
                }),
            }

            // Compute convert_progress
            const totalSlices = await this.prismaService.universal_stimulator_video_split.count({
                where: { video_id: video.id },
            })
            const convertedSlices = await this.prismaService.universal_stimulator_video_split.count({
                where: {
                    video_id: video.id,
                    generate_status: SlicedVideoStatus.COMPLETED,
                },
            })
            videoInfoResponse.convert_progress = totalSlices > 0 ? Math.ceil((convertedSlices / totalSlices) * 100) : 0
            return videoInfoResponse
        } catch (error) {
            this.logger.error("Error getting current videos:", error)
            throw new InternalServerErrorException("Failed to get current videos")
        }
    }

    async getSlicedVideos(userInfo: UserInfoDTO, videoId: number, take: number = 10) {
        // Check if the video is completed or converted
        const originVideo = await this.prismaService.universal_stimulator_videos.findUnique({
            where: {
                id: videoId,
                user: userInfo.usernameShorted,
            },
        })
        if (!originVideo) {
            throw new NotFoundException("Video not found")
        }

        if (originVideo.current_status === VideoProcessStep.COMBINED) {
            return { total: 0, result: [] }
        }

        const total = await this.prismaService.universal_stimulator_video_split.count({
            where: { video_id: videoId },
        })
        const videoSplits = await this.prismaService.universal_stimulator_video_split.findMany({
            where: { video_id: videoId },
            take: take,
        })
        const result = []
        const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
        if (videoSplits && videoSplits.length > 0) {
            for (const split of videoSplits) {
                const signedUrl = await this.utilitiesService.createS3SignedUrl(split.path, s3Info)
                result.push({
                    id: split.id,
                    name: split.path,
                    thumbnail: split.thumbnail
                        ? await this.utilitiesService.createS3SignedUrl(split.thumbnail, s3Info)
                        : "",
                    generated_video_url: split.generated_video_path
                        ? await this.utilitiesService.createS3SignedUrl(split.generated_video_path, s3Info)
                        : "",
                    generated_video_download_url: split.generated_video_path
                        ? await this.utilitiesService.createS3SignedUrl(split.generated_video_path, s3Info, true)
                        : "",
                    sequence: split.sequence,
                    status: split.generate_status,
                    signed_url: signedUrl,
                })
            }
        }
        return { total, result }
    }

    private async _mergeVideo(videoId: number) {
        try {
            // Check if the video exists and belongs to the user
            // Find all sliced videos and check if they are all completed
            const video = await this.prismaService.universal_stimulator_videos.findFirst({
                where: {
                    id: videoId,
                },
                include: {
                    sliced_videos: {
                        orderBy: {
                            sequence: "asc",
                        },
                    },
                },
            })

            if (!video) {
                throw new Error("Video not found or you do not have permission to access it.")
            }

            if (video.current_status !== VideoProcessStep.CONVERTED) {
                throw new Error("Video is not converted yet.")
            }

            const allSlicedVideos = video.sliced_videos
            const allCompleted = allSlicedVideos.every((sv) => sv.generate_status === SlicedVideoStatus.COMPLETED)

            if (!allCompleted) {
                throw new Error(
                    "Not all sliced videos are completed. Please wait for all videos to complete before merging.",
                )
            }

            const taskId = v4()
            const s3Info = await this.utilitiesService.getS3Info(video.user)
            const task = await this.taskService.taskCreateRequest({
                method: "VideoService.VideoConcat",
                params: [
                    {
                        bucket: s3Info.s3_bucket,
                        parts: video.sliced_videos.map((sv) => sv.generated_video_path),
                    } as VideoConcatDto,
                ],
                id: taskId,
            })

            if (task && task.result && task.result.task_id) {
                await this.prismaService.universal_stimulator_videos.update({
                    where: { id: videoId },
                    data: {
                        current_status: VideoProcessStep.COMBINING,
                        concat_task_id: task.result.task_id,
                    },
                })
                return {}
            } else {
                throw new Error("Failed to create video merge task")
            }
        } catch (error) {
            this.logger.error("Error in mergeVideo:", error)
            await this.prismaService.universal_stimulator_videos.update({
                where: { id: videoId },
                data: {
                    current_status: VideoProcessStep.FAILED,
                },
            })
            throw error
        }
    }

    async cancelVideo(userInfo: UserInfoDTO, body: VideoCancelParamsDto) {
        try {
            const video = await this.prismaService.universal_stimulator_videos.findFirst({
                where: {
                    id: body.video_id,
                    user: userInfo.usernameShorted,
                },
            })
            if (!video) {
                throw new Error("Video not found or you do not have permission to access it.")
            }

            return await this.prismaService.$transaction(async (prisma) => {
                const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)
                const cleanTaskId = await this._cleanCache(video, s3Info)
                await prisma.universal_stimulator_video_split.deleteMany({
                    where: {
                        video_id: body.video_id,
                    },
                })
                const record = await prisma.universal_stimulator_videos.update({
                    where: { id: body.video_id },
                    data: {
                        current_status: VideoProcessStep.CANCELLED,
                        clean_cache_task_id: cleanTaskId,
                    },
                })
                //refund credit
                const relatedIds = this.creditService.generateRelatedId(body.video_id, "video2video")
                await this.creditService.refundCredit(relatedIds)
                return record
            })
        } catch (error) {
            this.logger.error(
                `Error in cancelVideo: ${error.message}, request body: ${JSON.stringify(body)}, userInfo: ${JSON.stringify(userInfo)}`,
                error.stack,
            )
            throw new InternalServerErrorException("Failed to cancel video: " + error.message)
        }
    }

    public static async deleteFileFromS3(fileName: string, s3Info: S3InfoDto) {
        const s3 = new S3({
            accessKeyId: s3Info.s3_access_key,
            secretAccessKey: s3Info.s3_secret_key,
            region: s3Info.s3_region,
            endpoint: s3Info.s3_endpoint,
            s3ForcePathStyle: true,
        })
        await s3.deleteObject({ Bucket: s3Info.s3_bucket, Key: fileName }).promise()
    }

    private async _cleanCache(videoInfo: universal_stimulator_videos, s3Info: S3InfoDto): Promise<string | null> {
        const videoSplitTask = await this.taskService.taskCreateRequest({
            method: "VideoService.Finish",
            params: [
                {
                    bucket: s3Info.s3_bucket,
                    file_name: videoInfo.name,
                } as VideoFinishDto,
            ],
            id: v4(),
        })
        if (videoSplitTask.result && videoSplitTask.result.task_id) {
            this.logger.log(`Clean cache task created with task ID: ${videoSplitTask.result.task_id}`)
            return videoSplitTask.result.task_id
        }
        return null
    }

    async checkVideoCombineStatus(limit: number = 100) {
        this.logger.log("Checking video combine status")
        const pendingTasks = await this.prismaService.universal_stimulator_videos.findMany({
            where: {
                current_status: VideoProcessStep.COMBINING,
                concat_task_id: { not: null },
            },
            include: {
                user_info: true,
            },
        })

        this.logger.log(`Found ${pendingTasks.length} pending combine tasks`)

        for (const task of pendingTasks) {
            try {
                const taskQuery: TaskQueryDto = {
                    method: "QueryService.Task",
                    params: [
                        {
                            task_id: task.concat_task_id,
                            task_type: "VideoConcat",
                            user_id: task.user_info.email,
                        },
                    ],
                    id: v4(),
                }

                const response: TaskQueryResponseDto<TaskQueryResponseResult> =
                    await this.taskService.taskQueryRequest(taskQuery)
                this.logger.log(
                    `Task query response for combine task ${task.concat_task_id}:`,
                    JSON.stringify(response, null, 2),
                )

                if (response.result.status === 2) {
                    // Task completed successfully
                    const combinedVideoPath = response.result.result as string
                    const result = await this.prismaService.universal_stimulator_videos.update({
                        where: { id: task.id },
                        data: {
                            current_status: VideoProcessStep.COMBINED,
                            concat_path: combinedVideoPath,
                        },
                    })
                    //clear cache
                    await this._cleanCache(result, await this.utilitiesService.getS3Info(result.user))

                    //add video to assets
                    await this.assetsService.uploadedByTask(
                        { usernameShorted: task.user },
                        {
                            object_key: combinedVideoPath,
                            name: combinedVideoPath.split("/").pop() || combinedVideoPath,
                            source_video: task.id,
                            category: "exports",
                            exported_by: "video-2-video",
                            task_id: task.concat_task_id,
                        },
                    )

                    //complete credit
                    const relatedIds = this.creditService.generateRelatedId(task.id, "video2video")
                    await this.creditService.completeCredit(relatedIds)
                } else if (response.result.status === 3) {
                    // Task failed
                    await this.prismaService.universal_stimulator_videos.update({
                        where: { id: task.id },
                        data: {
                            current_status: VideoProcessStep.FAILED,
                        },
                    })
                }
            } catch (error) {
                this.logger.error(`Error checking video combine status for task ${task.concat_task_id}:`, error)
                continue
            }
        }
        this.logger.log("Video combine status check completed")
    }

    async checkVideoSplitStatus(limit: number = 100) {
        this.logger.log("Checking video split status")
        const pendingTasks = await this.prismaService.universal_stimulator_videos.findMany({
            where: {
                current_status: VideoProcessStep.SLICING,
                split_task_id: { not: null },
            },
            include: {
                user_info: true,
            },
            take: limit,
        })

        this.logger.log(`Found ${pendingTasks.length} pending tasks`)

        for (const task of pendingTasks) {
            try {
                const taskQuery: TaskQueryDto = {
                    method: "QueryService.Task",
                    params: [
                        {
                            task_id: task.split_task_id,
                            task_type: "VideoSplit",
                            user_id: task.user_info.email,
                        },
                    ],
                    id: v4(),
                }

                const response: TaskQueryResponseDto<TaskQueryResponseResult> =
                    await this.taskService.taskQueryRequest(taskQuery)
                this.logger.log(
                    `Task query response for task ${task.split_task_id}:`,
                    JSON.stringify(response, null, 2),
                )

                if (response.result.status === 2) {
                    // Start a Prisma transaction
                    await this.prismaService.$transaction(async (prisma) => {
                        await prisma.universal_stimulator_video_split.deleteMany({
                            where: { video_id: task.id },
                        })
                        // Create split records for each split part
                        const splitPaths = JSON.parse(response.result.result as string) as VideoSplitTaskResponseDto[]
                        for (let i = 0; i < splitPaths.length; i++) {
                            await prisma.universal_stimulator_video_split.create({
                                data: {
                                    video_id: task.id,
                                    sequence: i,
                                    path: splitPaths[i].file_name,
                                    thumbnail: splitPaths[i].thumbnail,
                                    generate_status: SlicedVideoStatus.READY,
                                },
                            })
                        }
                        await prisma.universal_stimulator_videos.update({
                            where: { id: task.id },
                            data: {
                                current_status: VideoProcessStep.SLICED,
                            },
                        })
                    })
                } else if (response.result.status === 3) {
                    // Failed
                    await this.prismaService.universal_stimulator_videos.update({
                        where: { id: task.id },
                        data: {
                            current_status: VideoProcessStep.FAILED,
                        },
                    })
                }
            } catch (error) {
                this.logger.error(`Error checking video split status for task ${task.split_task_id}:`, error)
                continue
            }
        }

        //submit generate task for sliced videos
        const slicedVideos = await this.prismaService.universal_stimulator_videos.findMany({
            where: {
                current_status: VideoProcessStep.SLICED,
            },
        })
        for (const video of slicedVideos) {
            try {
                await this._submitGenerateTask(video.id)
            } catch (error) {
                this.logger.error(`Error submitting generate task for video ${video.id}:`, error)
                continue
            }
        }
        this.logger.log("Video split status check completed")
    }

    async checkPendingVideoQueuePosition(limit: number = 100) {
        this.logger.log("Checking pending video queue position")
        const pendingVideos = await this.prismaService.universal_stimulator_video_split.findMany({
            where: { generate_status: SlicedVideoStatus.PENDING },
            include: {
                video_info: {
                    include: {
                        user_info: true,
                    },
                },
            },
            take: limit,
        })
        for (const video of pendingVideos) {
            try {
                const previousRecordCount = await this.prismaService.universal_stimulator_video_split.count({
                    where: {
                        video_id: video.video_id,
                        generate_status: { in: [SlicedVideoStatus.PENDING] },
                        updated_at: { lt: new Date(video.updated_at) },
                    },
                })
                await this.prismaService.universal_stimulator_video_split.update({
                    where: { id: video.id },
                    data: {
                        queue_position: Math.max(previousRecordCount, 1),
                    },
                })
            } catch (error) {
                this.logger.error("Error checking pending video queue position:", error)
                continue
            }
        }
        this.logger.log("Pending video queue position check completed")
    }

    async checkVideoConvertStatus(limit: number = 100) {
        this.logger.log("Checking video convert status")

        //process limit to 100
        const pendingConvertTasks = await this.prismaService.universal_stimulator_video_split.findMany({
            where: {
                generate_status: { in: [SlicedVideoStatus.PENDING, SlicedVideoStatus.CONVERTING] },
            },
            include: {
                video_info: {
                    include: {
                        user_info: true,
                        sliced_videos: true,
                    },
                },
            },
            take: limit,
        })

        for (const task of pendingConvertTasks) {
            try {
                if (!task.generate_task_id) {
                    this.logger.warn(`Task ${task.id} has no generate_task_id`)
                    continue
                }

                const response = await this.taskService.taskQueryRequest({
                    method: "QueryService.Task",
                    params: [
                        {
                            task_id: task.generate_task_id,
                            task_type: "VideoConvert",
                            user_id: task.video_info.user_info.email,
                        },
                    ],
                    id: v4(),
                })

                this.logger.log(
                    `Task query response for task ${task.generate_task_id}:`,
                    JSON.stringify(response, null, 2),
                )

                switch (response.result.status) {
                    case 2:
                        // Conversion completed successfully
                        await this.prismaService.universal_stimulator_video_split.update({
                            where: { id: task.id },
                            data: {
                                generate_status: SlicedVideoStatus.COMPLETED,
                                generated_video_path: response.result.result as string,
                                queue_position: 0,
                            },
                        })
                        break
                    case 3:
                        await this.prismaService.universal_stimulator_video_split.update({
                            where: { id: task.id },
                            data: {
                                generate_status: SlicedVideoStatus.FAILED,
                                queue_position: 0,
                            },
                        })
                        break
                    case 4:
                        await this.prismaService.universal_stimulator_video_split.update({
                            where: { id: task.id },
                            data: {
                                generate_status: SlicedVideoStatus.STOPPED,
                                queue_position: 0,
                            },
                        })
                        break
                    case 1:
                        await this.prismaService.universal_stimulator_video_split.update({
                            where: { id: task.id },
                            data: {
                                generate_status: SlicedVideoStatus.CONVERTING,
                                queue_position: 0,
                            },
                        })
                        break
                    case 0:
                        await this.prismaService.universal_stimulator_video_split.update({
                            where: { id: task.id },
                            data: {
                                generate_status: SlicedVideoStatus.PENDING,
                            },
                        })
                        break
                    default:
                        this.logger.warn(
                            `Unexpected status ${response.result.status} for task ${task.generate_task_id}`,
                        )
                        break
                }

                const allSlicesConverted = await this.prismaService.universal_stimulator_video_split.findMany({
                    where: {
                        video_id: task.video_id,
                        generate_status: {
                            in: [SlicedVideoStatus.COMPLETED, SlicedVideoStatus.FAILED, SlicedVideoStatus.STOPPED],
                        },
                    },
                })

                if (allSlicesConverted.length === task.video_info.sliced_videos.length) {
                    const allSlicesCompleted = allSlicesConverted.every(
                        (slice) => slice.generate_status === SlicedVideoStatus.COMPLETED,
                    )
                    const anySliceFailedOrStopped = allSlicesConverted.some(
                        (slice) =>
                            slice.generate_status === SlicedVideoStatus.FAILED ||
                            slice.generate_status === SlicedVideoStatus.STOPPED,
                    )

                    if (allSlicesCompleted) {
                        await this.prismaService.universal_stimulator_videos.update({
                            where: { id: task.video_id },
                            data: {
                                current_status: VideoProcessStep.CONVERTED,
                            },
                        })
                        //merge video
                        await this._mergeVideo(task.video_id)
                    } else if (anySliceFailedOrStopped) {
                        await this.prismaService.universal_stimulator_videos.update({
                            where: { id: task.video_id },
                            data: {
                                current_status: VideoProcessStep.FAILED,
                            },
                        })
                    }
                }
            } catch (error) {
                this.logger.error(`Error checking video convert status for task ${task.generate_task_id}:`, error)
                continue
            }
        }
        this.logger.log("Video convert status check completed")
    }

    async getVideoQueuePosition(videoId: number) {
        const video = await this.prismaService.universal_stimulator_videos.findUnique({
            where: { id: videoId },
            include: {
                sliced_videos: true,
            },
        })
        if (!video) {
            throw new Error("Video not found")
        }
        if (video.current_status !== VideoProcessStep.CONVERTING || video.sliced_videos.length === 0) {
            return 0
        }
        const allPending = video.sliced_videos.every((slice) => slice.generate_status === SlicedVideoStatus.PENDING)
        return allPending ? video.sliced_videos[0].queue_position || 1 : 0
    }

    public static formatTime(seconds: number) {
        const hours = Math.floor(seconds / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        const remainingSeconds = seconds % 60
        return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`
    }

    private async _submitSplitTask(splitParams: VideoSplitDto) {
        return await this.taskService.taskCreateRequest({
            method: "VideoService.VideoSplit",
            params: [splitParams],
            id: v4(),
        })
    }

    /**
     * Submit generate task for a video
     * @param videoId
     * @returns
     */
    private async _submitGenerateTask(videoId: number) {
        try {
            const video = await this.prismaService.universal_stimulator_videos.findUnique({
                where: { id: videoId },
            })

            const generate_params = video.generate_params as unknown as VideoGenerateParamsDto

            //process user args
            const user_args = []
            if (generate_params.seed) {
                user_args.push({
                    root: "2",
                    name: "seed",
                    value: generate_params.seed,
                })
            }

            if (generate_params.total_strength) {
                user_args.push({
                    root: "2",
                    name: "denoise",
                    value: (generate_params.total_strength / 100).toString(),
                })
            }

            if (generate_params.prompt && generate_params.prompt.trim() !== "") {
                user_args.push({
                    root: "3",
                    name: "text",
                    value: generate_params.prompt.trim(),
                })
            }

            // Check and adjust video dimensions if necessary
            const videoInfo = video.video_info as unknown as VideoInfoTaskResponseDto
            let width = videoInfo.width
            let height = videoInfo.height

            let maxPx = 1920
            if (generate_params.resolution === "720") {
                maxPx = 1280
            }

            if (width > maxPx || height > maxPx) {
                const aspectRatio = width / height
                if (width > height) {
                    width = maxPx
                    height = Math.round(width / aspectRatio)
                } else {
                    height = maxPx
                    width = Math.round(height * aspectRatio)
                }
                this.logger.log(`Resizing video from ${videoInfo.width}x${videoInfo.height} to ${width}x${height}`)
            }

            user_args.push({
                root: "14",
                name: "width",
                value: width,
            })

            user_args.push({
                root: "14",
                name: "height",
                value: height,
            })

            const slicedVideos = await this.prismaService.universal_stimulator_video_split.findMany({
                where: {
                    video_id: video.id,
                    generate_status: {
                        notIn: [SlicedVideoStatus.PENDING, SlicedVideoStatus.CONVERTING, SlicedVideoStatus.COMPLETED],
                    },
                },
            })

            if (slicedVideos.length === 0) {
                throw new Error("No sliced video to generate.")
            }

            const s3Info = await this.utilitiesService.getS3Info(video.user)

            for (const slicedVideo of slicedVideos) {
                try {
                    await this.prismaService.universal_stimulator_video_split.update({
                        where: { id: slicedVideo.id },
                        data: {
                            generate_status: SlicedVideoStatus.PENDING,
                            generate_params: generate_params as any,
                        },
                    })
                    const taskId = v4()
                    const task = await this.taskService.taskCreateRequest({
                        method: "VideoService.VideoConvert",
                        params: [
                            {
                                bucket: s3Info.s3_bucket,
                                file_name: slicedVideo.path,
                                style_name: generate_params.preset,
                                addition: generate_params.enhance_effect ? "fastblend" : "",
                                user_args: user_args,
                            } as VideoConvertDto,
                        ],
                        id: taskId,
                    })

                    if (task && task.result && task.result.task_id) {
                        await this.prismaService.universal_stimulator_video_split.update({
                            where: { id: slicedVideo.id },
                            data: {
                                generate_task_id: task.result.task_id,
                            },
                        })
                    } else {
                        //update sliced video record to failed
                        await this.prismaService.universal_stimulator_video_split.update({
                            where: { id: slicedVideo.id },
                            data: {
                                generate_status: SlicedVideoStatus.FAILED,
                                generate_params: generate_params as any,
                            },
                        })
                        this.logger.error(
                            `Failed to create video convert task for sliced video ${slicedVideo.path}, videoId: ${videoId}, create task response: ${JSON.stringify(task)}`,
                        )
                    }
                } catch (error) {
                    this.logger.error(
                        `Error on submitGenerateTask for sliced video id: ${slicedVideo.id}, videoId: ${videoId}, error: ${error.message}`,
                    )
                    continue
                }
            }

            // Check if any sliced video is in PENDING or PROCESSING status
            const convertingSlicedVideoExists = await this.prismaService.universal_stimulator_video_split.findFirst({
                where: {
                    video_id: video.id,
                    generate_status: {
                        in: [SlicedVideoStatus.PENDING, SlicedVideoStatus.CONVERTING],
                    },
                },
            })

            // Update the main video record only if a converting sliced video exists
            if (convertingSlicedVideoExists) {
                await this.prismaService.universal_stimulator_videos.update({
                    where: { id: video.id },
                    data: {
                        current_status: VideoProcessStep.CONVERTING,
                        generate_params: generate_params as any,
                    },
                })
            }

            const hasFailed = await this.prismaService.universal_stimulator_video_split.findFirst({
                where: {
                    video_id: video.id,
                    generate_status: SlicedVideoStatus.FAILED,
                },
            })

            if (hasFailed && !convertingSlicedVideoExists) {
                await this.prismaService.universal_stimulator_videos.update({
                    where: { id: video.id },
                    data: {
                        current_status: VideoProcessStep.FAILED,
                    },
                })
            }
        } catch (error) {
            this.logger.error("Error on submitGenerateTask:", `${error}, videoId: ${videoId}`)
            await this.prismaService.universal_stimulator_videos.update({
                where: { id: videoId },
                data: {
                    current_status: VideoProcessStep.FAILED,
                },
            })
            throw new InternalServerErrorException(`Error on submitGenerateTask: ${error.message}`)
        }
    }

    async generateVideo(userInfo: UserInfoDTO, body: VideoGenerateParamsDto) {
        try {
            // Check if the video exists and belongs to the user
            const video = await this.prismaService.universal_stimulator_videos.findFirst({
                where: {
                    id: body.video_id,
                    user: userInfo.usernameShorted,
                    current_status: VideoProcessStep.UPLOADED,
                },
            })

            if (!video) {
                throw new Error("Video not found or you do not have permission to access it.")
            }

            const range = Array.isArray(body.convert_seconds)
                ? [body.convert_seconds[0], body.convert_seconds[1]]
                : [0, body.convert_seconds]

            const convertSeconds = Math.ceil(range[1] - range[0])
            const userProfile = await this.userService.getProfile(userInfo)
            const consumeCredit = this.creditService.computeGenerateCredit(
                userProfile.subscription_info,
                convertSeconds,
                "video2video",
            )
            const maxAllowedSeconds = this.creditService.getAllowedGenerateSeconds(userProfile.subscription_info)

            if (userProfile.credit < consumeCredit) {
                throw new BadRequestException("Insufficient credits")
            }

            if (convertSeconds > maxAllowedSeconds) {
                throw new BadRequestException(`You can only generate up to ${maxAllowedSeconds} seconds of video.`)
            }

            const splitSeconds = convertSeconds > 10 ? 10 : convertSeconds

            const start = VideoToVideoService.formatTime(range[0])
            const end = VideoToVideoService.formatTime(range[1])

            const s3Info = await this.utilitiesService.getS3Info(userInfo.usernameShorted)

            const splitParams = {
                file_name: video.name,
                bucket: s3Info.s3_bucket,
                format: "mp4",
                time: splitSeconds,
                start: start,
                end: end,
            } as VideoSplitDto

            const videoSplitTask = await this._submitSplitTask(splitParams)

            const generate_params = { ...body } as VideoGenerateParamsDto
            delete generate_params.video_id
            delete generate_params.sliced_video_ids
            delete generate_params.method
            generate_params.split_params = splitParams

            if (videoSplitTask.result && videoSplitTask.result.task_id) {
                const splitTaskId = videoSplitTask.result.task_id
                this.logger.log(`Video split task created with ID: ${splitTaskId}`)
                await this.prismaService.universal_stimulator_videos.update({
                    where: { id: video.id },
                    data: {
                        generate_params: generate_params as any,
                        current_status: VideoProcessStep.SLICING,
                        split_task_id: splitTaskId,
                    },
                })
            } else {
                throw new Error("Failed to create genarate task")
            }

            await this.creditService.pendingCredit(
                userInfo,
                consumeCredit,
                this.creditService.generateRelatedId(video.id, "video2video"),
            )
            return this.getVideoDetail(userInfo, video.id)
        } catch (error) {
            this.logger.error("Error on generateVideo:", error)
            throw new BadRequestException(error.message)
        }
    }

    async stopGenerateVideo(userInfo: UserInfoDTO, body: VideoStopGenerateParamsDto) {
        try {
            const video = await this.prismaService.universal_stimulator_videos.findFirst({
                where: { id: body.video_id, user: userInfo.usernameShorted },
                include: {
                    sliced_videos: true,
                },
            })

            if (!video) {
                throw new Error("Video not found or you do not have permission to access it.")
            }

            if (video.current_status !== VideoProcessStep.CONVERTING) {
                throw new Error("Video is not currently being converted.")
            }

            // Find all converting or pending sliced videos
            const convertingOrPendingSlicedVideos = video.sliced_videos.filter(
                (sv) =>
                    sv.generate_status === SlicedVideoStatus.CONVERTING ||
                    sv.generate_status === SlicedVideoStatus.PENDING,
            )

            // Request stop for each converting or pending sliced video
            const stopTasks = convertingOrPendingSlicedVideos.map(async (slicedVideo) => {
                const stopTask: TaskCreateDto = {
                    method: "VideoService.ConvertStop",
                    params: [
                        {
                            task_id: slicedVideo.generate_task_id,
                        } as VideoStopGenerateDto,
                    ],
                    id: v4(),
                }

                const response = await this.taskService.taskCreateRequest(stopTask)
                if (response?.error) {
                    throw new Error(`Failed to stop task for sliced video ${slicedVideo.path}. ${response.error}`)
                }
            })

            await Promise.all(stopTasks)

            await this.prismaService.universal_stimulator_videos.update({
                where: { id: video.id },
                data: {
                    current_status: VideoProcessStep.CONVERT_HANGING,
                },
            })

            await this.checkVideoConvertStatus()
            return {}
        } catch (error) {
            this.logger.error("Error in stopGenerateVideo:", error)
            throw new BadRequestException(error.message)
        }
    }
}
