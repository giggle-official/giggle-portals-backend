import {
    Body,
    Controller,
    Get,
    HttpStatus,
    HttpCode,
    Param,
    Post,
    Query,
    Req,
    UseGuards,
    Sse,
    Headers,
} from "@nestjs/common"
import { IpLibraryService } from "./ip-library.service"
import {
    AddShareCountDto,
    AvailableParentIpsDto,
    CreateIpDto,
    EditIpDto,
    GenreDto,
    GetListParams,
    GetMyListParams,
    IpLibraryDetailDto,
    IpLibraryListDto,
    IpNameCheckDto,
    LikeIpDto,
    SetVisibilityDto,
    LaunchIpTokenDto,
    UnlikeIpDto,
    UntokenizeDto,
    IpEventsDetail,
} from "./ip-library.dto"
import {
    ApiBody,
    ApiParam,
    ApiResponse,
    ApiTags,
    ApiOperation,
    ApiBearerAuth,
    ApiExcludeEndpoint,
    ApiHeaders,
} from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { UserJwtExtractDto } from "src/user/user.controller"
import { Request } from "express"
import { SSEMessage } from "src/web3/giggle/giggle.dto"
import { NologInterceptor } from "src/common/bypass-nolog.decorator"
import { ValidEventBody } from "src/common/rawbody.decorator"
import { OptionalJwtAuthGuard } from "src/auth/optional-jwt-auth.guard"
import { CheckJwtPolicies, JwtPoliciesGuard } from "src/guards/jwt-policies.guard"

@Controller("/api/v1/ip-library")
@ApiTags("IP Library")
export class IpLibraryController {
    constructor(private readonly ipLibraryService: IpLibraryService) {}

    @Get("/")
    @ApiHeaders([
        {
            name: "app-id",
            required: false,
        },
    ])
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: "Get list of ip libraries" })
    @ApiResponse({ type: IpLibraryListDto, status: 200 })
    async get(
        @Req() req: Request,
        @Query() query: GetListParams,
        @Headers("app-id") app_id?: string,
    ): Promise<IpLibraryListDto> {
        return await this.ipLibraryService.getList(query, true, null, null, app_id, req?.user as UserJwtExtractDto)
    }

    @Post("/ip-name-check")
    @ApiOperation({ summary: "Check if ip name is available" })
    @ApiBody({ type: IpNameCheckDto })
    @ApiResponse({ type: Boolean })
    async ipNameCheck(@Body() dto: IpNameCheckDto) {
        return this.ipLibraryService.ipNameCheck(dto)
    }

    @Get("/my")
    @ApiOperation({ summary: "Get my ip libraries" })
    @UseGuards(AuthGuard("jwt"), JwtPoliciesGuard)
    @CheckJwtPolicies((abilities) => abilities.can("read_ip"))
    @ApiBearerAuth()
    @ApiResponse({ type: IpLibraryListDto, status: 200 })
    async getMy(@Req() req: Request, @Query() query: GetMyListParams): Promise<IpLibraryListDto> {
        return await this.ipLibraryService.getList(
            query,
            query.is_public === "true" ? true : query.is_public === "false" ? false : null,
            req.user as UserJwtExtractDto,
            null,
            null,
            req.user as UserJwtExtractDto,
        )
    }

    @Get("/genres")
    @ApiOperation({ summary: "Get video genres" })
    @ApiResponse({ type: [GenreDto], status: 200 })
    async getGenres(): Promise<GenreDto[]> {
        return this.ipLibraryService.getGenres()
    }

    @Post("/add-share-count")
    @ApiOperation({ summary: "Add share count to an ip library" })
    @ApiBody({ type: AddShareCountDto })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async addShareCount(@Body() dto: AddShareCountDto, @Req() req: any): Promise<IpLibraryDetailDto> {
        return this.ipLibraryService.addShareCount(dto, req.user as UserJwtExtractDto)
    }

    @Post("like")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "Like an ip library" })
    @ApiBody({ type: LikeIpDto })
    async likeIp(@Body() dto: LikeIpDto, @Req() req: any): Promise<IpLibraryDetailDto> {
        return this.ipLibraryService.likeIp(dto.id, req.user as UserJwtExtractDto)
    }

    @Post("unlike")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiOperation({ summary: "Unlike an ip library" })
    @ApiBody({ type: UnlikeIpDto })
    async unlikeIp(@Body() dto: UnlikeIpDto, @Req() req: any): Promise<IpLibraryDetailDto> {
        return this.ipLibraryService.unlikeIp(dto.id, req.user as UserJwtExtractDto)
    }

    @Get("/available-parent-ips")
    @ApiOperation({ summary: "Get available parent ips" })
    @ApiResponse({ type: AvailableParentIpsDto, status: 200 })
    @ApiBearerAuth()
    //@ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    async getAvailableParentIps(@Req() req: Request) {
        return await this.ipLibraryService.getAvailableParentIps(req.user as UserJwtExtractDto)
    }

    @Get("/my/:id")
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @ApiOperation({ summary: "Get detail of ip library" })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    @ApiParam({ name: "id", type: Number })
    async getMyDetail(@Req() req: Request, @Param("id") id: string): Promise<IpLibraryDetailDto> {
        return await this.ipLibraryService.detail(
            id,
            null,
            req.user as UserJwtExtractDto,
            req.user as UserJwtExtractDto,
        )
    }

    @Post("/set-visibility")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Set visibility of ip library" })
    @ApiBody({ type: SetVisibilityDto })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    async setIpVisibility(@Req() req: Request, @Body() body: SetVisibilityDto): Promise<IpLibraryDetailDto> {
        return await this.ipLibraryService.setIpVisibility(req.user as UserJwtExtractDto, body)
    }

    @Post("/untokenize")
    @ApiOperation({ summary: "Untokenize an ip library" })
    @ApiBody({ type: UntokenizeDto })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiBearerAuth()
    async untokenize(@Req() req: Request, @Body() body: UntokenizeDto): Promise<IpLibraryDetailDto> {
        return await this.ipLibraryService.untokenize(req.user as UserJwtExtractDto, body)
    }

    @Post("/create-ip")
    @ApiBody({ type: CreateIpDto })
    @ApiResponse({ status: 200, type: IpLibraryDetailDto })
    @ApiOperation({
        summary: "Create ip library",
        description: `create a new ip but do not launch ip token`,
    })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    createIp(@Req() req: Request, @Body() body: CreateIpDto) {
        return this.ipLibraryService.createIp(req.user as UserJwtExtractDto, body)
    }

    @Post("/update-ip")
    @ApiBody({ type: EditIpDto })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    @ApiOperation({
        summary: "Update an ip",
        description: `update an ip, only un-launch ip can be updated`,
    })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    editIp(@Req() req: Request, @Body() body: EditIpDto) {
        return this.ipLibraryService.editIp(req.user as UserJwtExtractDto, body)
    }

    @Post("/launch-ip-token")
    @Sse("/launch-ip-token")
    @ApiBody({ type: LaunchIpTokenDto })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiOperation({
        summary: "Launch ip token",
        description: `
Returns SSE stream with progress updates and final result, 
sse event: 

**event list:**

${IpEventsDetail.map((item) => `- ${item.event}\n\n \`\`\`json\n${JSON.stringify(item, null, 2)}\n\`\`\``).join("\n")}

**error event:**

if error occurs, the event will be \`error\` and the data in \`data\` is the error message, sse will be closed.
`,
    })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @NologInterceptor()
    launchIpToken(@Req() req: Request, @ValidEventBody() body: LaunchIpTokenDto) {
        return this.ipLibraryService.launchIpToken(req.user as UserJwtExtractDto, body)
    }

    @Get("/:id")
    @ApiOperation({ summary: "Get detail of ip library" })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    @UseGuards(OptionalJwtAuthGuard)
    @ApiParam({ name: "id", type: Number })
    async getDetail(@Param("id") id: string, @Req() req: Request): Promise<IpLibraryDetailDto> {
        return await this.ipLibraryService.detail(id, true, null, req?.user as UserJwtExtractDto)
    }

    @Post("/register-token")
    @ApiOperation({ summary: "Register token for an ip" })
    @ApiResponse({ status: 200 })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiExcludeEndpoint()
    registerToken(@Req() req: Request, @Body() body: { id: number }) {
        return this.ipLibraryService.registerToken(req.user as UserJwtExtractDto, body.id)
    }

    @Get("/signature-clips/:id")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    async getSignatureClipDetail(@Param("id") id: string) {
        return await this.ipLibraryService.signatureClipDetail(id)
    }
}
