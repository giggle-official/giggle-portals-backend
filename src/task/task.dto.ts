import { TaskFaceExtractDto, TaskFaceSwapDto } from "src/universal-stimulator/face-swap/face-swap.dto"
import { TaskGenerateImageDto } from "src/universal-stimulator/generate-image/generate-image.dto"
import { TaskGenerateVideoDto } from "src/universal-stimulator/generate-video/generate-video.dto"
import { VideoFormatDto, VideoTranscodeDto } from "src/assets/assets.dto"
export class TaskCreateDto {
    method:
        | "VideoService.VideoInfo"
        | "VideoService.VideoSplit"
        | "VideoService.VideoConcat"
        | "VideoService.VideoConvert"
        | "VideoService.ConvertStop"
        | "VideoService.VideoTranscode"
        | "VideoService.Finish"
        | "VideoService.VideoFormat"
        | "FaceService.Detect"
        | "FaceService.Swap"
        | "NewVideoService.FromTxt"
        | "NewVideoService.FromImg"
        | "ImageService.Gen"
    params:
        | VideoInfoTaskDto[]
        | VideoSplitDto[]
        | VideoConcatDto[]
        | VideoConvertDto[]
        | VideoStopGenerateDto[]
        | VideoFinishDto[]
        | VideoTranscodeDto[]
        | VideoFormatDto[]
        | TaskFaceExtractDto[]
        | TaskFaceSwapDto[]
        | TaskGenerateVideoDto[]
        | TaskGenerateImageDto[]
    id: string
}

export class TaskCreateResponseDto<T = string> {
    result: {
        task_id: T
    }
    error: string | null
    id: string
}

export class TaskQueryDto {
    method: "QueryService.Task" | "QueryService.TaskWait"
    params: {
        task_id: string
        task_type?:
            | "VideoInfo"
            | "VideoSplit"
            | "VideoConcat"
            | "VideoConvert"
            | "VideoTranscode"
            | "VideoFormat"
            | "ConvertStop"
            | "Finish"
            | "FaceDetect"
            | "FaceSwap"
            | "Txt2Video"
            | "Img2Video"
            | "ImageGenerate"
        user_id: string
        bucket?: string
    }[]
    id: string
}

export class TaskQueryResponseDto<T> {
    result: T
    error: string | null
    id: string
}

export class TaskQueryResponseResult {
    /**
     * 0: pending
     * 1: processing
     * 2: success
     * 3: failed
     * 4: cancelled
     */
    status: 0 | 1 | 2 | 3 | 4
    result: VideoInfoTaskResponseDto | VideoSplitTaskResponseDto | string | string[]
}

export class VideoInfoTaskDto {
    bucket: string
    file_name: string
}

export class VideoInfoTaskResponseDto {
    duration: number
    width: number
    height: number
    thumbnail: string
    size?: number
}

export class QueuePositionTaskResponseDto {
    queue_total: number
    queue_number: number
    model_total: number
}

export class VideoSplitTaskResponseDto {
    file_name: string
    thumbnail: string
}

export class VideoSplitDto {
    bucket: string
    file_name: string
    format: "mp4"
    time: number
    start: string
    end: string
}

export class VideoConcatDto {
    bucket: string
    parts: string[]
}

export class VideoConvertDto {
    bucket: string
    file_name: string
    style_name: string
    addition: "fastblend" | ""
    user_args: VideoConvertUserArgsDto[]
}

export class VideoFinishDto {
    bucket: string
    file_name: string
}

export class VideoStopGenerateDto {
    task_id: string
}

export class VideoConvertUserArgsDto {
    root: string
    name: string
    value: string
}

export class NewVideoProcessResult {
    videoInfoTaskId: string
    videoInfo: VideoInfoTaskResponseDto
    thumbnail: string
    optimizedResult?: any
}

export class NewImageProcessResult {
    width: number
    height: number
    thumbnail: string
}
