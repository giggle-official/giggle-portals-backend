import { ApiProperty } from "@nestjs/swagger"
import { IsNotEmpty, IsNumber, IsOptional, IsString } from "class-validator"
import { PaginationDto } from "src/common/common.dto"

export class CreateCommentDto {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    ip_id: string

    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    content: string

    @ApiProperty({ required: false })
    @IsOptional()
    @IsString()
    reply_post_id?: string

    @ApiProperty({ type: "string", format: "binary", required: false })
    @IsOptional()
    image?: Express.Multer.File
}

export class UpdateCommentDto {
    @ApiProperty()
    @IsString()
    @IsOptional()
    content?: string
}

export class ListCommentReqDto extends PaginationDto {
    @ApiProperty()
    ip_id: string
}

export class CommentAuthorDto {
    @ApiProperty()
    @IsString()
    id: string

    @ApiProperty()
    @IsString()
    avatar: string

    @ApiProperty()
    @IsString()
    username: string
}

export class CommentResponseDto {
    id: number
    ip_id: number
    content: string
    image_url?: string
    author: CommentAuthorDto
    reply_post_id?: number
    likes: number
    from_app_id: string
    created_at: Date
    updated_at: Date
    reply_post?: CommentResponseDto[]
    user_has_liked?: boolean
}

export class ListCommentResDto {
    @ApiProperty({ type: [CommentResponseDto] })
    data: CommentResponseDto[]

    @ApiProperty()
    count: number
}

export class CommentQueryDto {
    @ApiProperty({ required: false })
    @IsNumber()
    @IsOptional()
    ip_id?: number

    @ApiProperty({ required: false })
    @IsNumber()
    @IsOptional()
    reply_post_id?: number
}

export class DeleteCommentDto {
    @ApiProperty()
    @IsNumber()
    @IsNotEmpty()
    id: number
}

export class LikeCommentDto extends DeleteCommentDto {}
export class UnlikeCommentDto extends DeleteCommentDto {}
