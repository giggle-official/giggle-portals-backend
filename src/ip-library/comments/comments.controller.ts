import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Put,
    Query,
    Req,
    UploadedFile,
    UseGuards,
    UseInterceptors,
    Headers,
    ParseIntPipe,
    BadRequestException,
    HttpCode,
    HttpStatus,
} from "@nestjs/common"
import { ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger"
import { CommentsService } from "./comments.service"
import {
    CreateCommentDto,
    CommentResponseDto,
    DeleteCommentDto,
    ListCommentReqDto,
    ListCommentResDto,
    LikeCommentDto,
    UnlikeCommentDto,
} from "./comments.dto"
import { FileInterceptor } from "@nestjs/platform-express"
import { AuthGuard } from "@nestjs/passport"
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard"

@ApiTags("Comments")
@Controller("/api/v1/ip/comments")
export class CommentsController {
    constructor(private readonly commentsService: CommentsService) {}

    @Get()
    @ApiOperation({ summary: "List comments by IP" })
    @UseGuards(OptionalJwtAuthGuard)
    async findAll(@Query() query: ListCommentReqDto, @Req() req: any): Promise<ListCommentResDto> {
        return this.commentsService.findAll(query, req.user?.usernameShorted)
    }

    @Post()
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Create a new comment" })
    @ApiConsumes("multipart/form-data")
    @UseInterceptors(
        FileInterceptor("image", {
            limits: {
                fileSize: 1024 * 1024 * 5, // 5MB
            },
            fileFilter: (req, file, cb) => {
                if (
                    file.mimetype === "image/jpeg" ||
                    file.mimetype === "image/png" ||
                    file.mimetype === "image/gif" ||
                    file.mimetype === "image/jpg"
                ) {
                    cb(null, true)
                } else {
                    cb(new Error("Invalid file type"), false)
                }
            },
        }),
    )
    async create(
        @Body() dto: CreateCommentDto,
        @UploadedFile() image: Express.Multer.File,
        @Req() req: any,
        @Headers("app-id") appId: string,
    ): Promise<CommentResponseDto> {
        if (!appId) {
            throw new BadRequestException("app-id header is required")
        }
        return this.commentsService.create(dto, req.user.usernameShorted, appId, image)
    }

    @Get(":id")
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: "Get one comment by ID" })
    @ApiParam({ name: "id", description: "Comment ID" })
    async findOne(@Param("id", ParseIntPipe) id: number, @Req() req: any): Promise<CommentResponseDto> {
        return this.commentsService.findOne(id, req.user?.usernameShorted)
    }

    //todo: add update comment
    /*
    @Post(":id")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "Update a comment" })
    @ApiParam({ name: "id", description: "Comment ID" })
    async update(
        @Param("id", ParseIntPipe) id: number,
        @Body() dto: UpdateCommentDto,
        @Req() req: any,
    ): Promise<CommentResponseDto> {
        return this.commentsService.update(id, dto, req.user.usernameShorted)
    }
    */

    @Post("/delete")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "Delete a comment" })
    @ApiBody({ type: DeleteCommentDto })
    async remove(@Body() dto: DeleteCommentDto, @Req() req: any, @Headers("app-id") appId: string): Promise<void> {
        if (!appId) {
            throw new BadRequestException("app-id header is required")
        }
        return this.commentsService.remove(dto.id, req.user.usernameShorted, appId)
    }

    @Post("like")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "Like a comment" })
    @ApiBody({ type: LikeCommentDto })
    async likeComment(@Body() dto: LikeCommentDto, @Req() req: any): Promise<CommentResponseDto> {
        return this.commentsService.likeComment(dto.id, req.user.usernameShorted)
    }

    @Post("unlike")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "Unlike a comment" })
    @ApiBody({ type: UnlikeCommentDto })
    async unlikeComment(@Body() dto: UnlikeCommentDto, @Req() req: any): Promise<CommentResponseDto> {
        return this.commentsService.unlikeComment(dto.id, req.user?.usernameShorted)
    }
}
