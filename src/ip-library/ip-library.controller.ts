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
    AvailableParentIpsDto,
    CreateIpDto,
    EditIpDto,
    GenreDto,
    GetListParams,
    IpLibraryDetailDto,
    IpLibraryListDto,
    LikeIpDto,
    RegisterTokenDto,
    RemixClipsDto,
    SetVisibilityDto,
    ShareToGiggleDto,
    TerritoryDto,
    UnlikeIpDto,
    UntokenizeDto,
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

    @Get("/my")
    @ApiOperation({ summary: "Get my ip libraries" })
    @UseGuards(AuthGuard("jwt"), JwtPoliciesGuard)
    @CheckJwtPolicies((abilities) => abilities.can("read_ip"))
    @ApiBearerAuth()
    @ApiResponse({ type: IpLibraryListDto, status: 200 })
    async getMy(@Req() req: Request, @Query() query: GetListParams): Promise<IpLibraryListDto> {
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

    @Get("/territories")
    @ApiOperation({ summary: "Get territories" })
    @ApiResponse({ type: [TerritoryDto], status: 200 })
    async getTerritories(): Promise<TerritoryDto[]> {
        return this.ipLibraryService.getTerritories()
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
    @Sse("/create-ip")
    @ApiBody({ type: CreateIpDto })
    @ApiResponse({
        status: 200,
        content: {
            "text/event-stream": {
                schema: {
                    type: "object",
                    properties: {
                        event: { type: "string" },
                        data: { type: "object", properties: { message: { type: "string" } } },
                    },
                },
            },
        },
    })
    @ApiOperation({
        summary: "Create ip library",
        description: `
Returns SSE stream with progress updates and final result, 
sse event:

**data structure:**
\`
{
  event: string,
  data: {
    message: string
  } | number
}
\`

**event list:**
- ip.data_validating

this event indicate the data is validating
- ip.asset_processing

this event indicate the asset is processing
- ip.video_uploading

this event indicate the video is uploading, at current step, data in \`data\` is the progress of video uploading
- ip.ip_library_creating

this event indicate the ip library is creating
- ip.push_ip_to_chain

this event indicate the ip is pushing to chain
- ip.share_to_giggle
  
this event indicate the ip is sharing to giggle, this event only exists when \`share_to_giggle\` is true in request body
- asset.uploading
  
this event indicate the asset of creating meme is uploading, at current step, data in \`data\` is the progress of asset uploading, this event only exists when \`share_to_giggle\` is true in request body
- meme.creating

this event indicate the meme is creating, this event only exists when \`share_to_giggle\` is true in request body
- meme.created

this event indicate the meme is created, this event only exists when \`share_to_giggle\` is true in request body
- ip.update_token_data_on_chain

this event indicate the ip is updating token data which just created to chain, this event only exists when \`share_to_giggle\` is true in request body
- ip.payment_processing

this event indicate the ip is processing payment, this event only exists when \`share_to_giggle\` is true in request body
- ip.payment_confirmed

this event indicate the ip is confirmed payment, this event only exists when \`share_to_giggle\` is true in request body
- ip.payment_refunded

this event indicate the ip is refunded payment, this event only exists when \`share_to_giggle\` is true in request body
- ip.created

this event indicate the ip is created, and the data in \`data\` is the detail of ip

- ip.warning

this event indicate the ip is created, but some warning occurs, this may ip token is created failed or ip token is registered failed, the data in \`data\` is the warning message

**error event:**

if error occurs, the event will be \`error\` and the data in \`data\` is the error message, subscriber will be completed.
data structure:

\`
event: error
id: 2
data: some error message
\`

`,
    })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @NologInterceptor()
    createIp(@Req() req: Request, @ValidEventBody() body: CreateIpDto) {
        return this.ipLibraryService.createIp(req.user as UserJwtExtractDto, body)
    }

    @Post("/update-ip")
    @Sse("/update-ip")
    @ApiBody({ type: EditIpDto })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiOperation({
        summary: "Update ip",
        description: `
Update an existing ip, do not allow to update if ip is on chain or token info is already created.
Returns SSE stream with progress updates and final result, 
sse event:

**data structure:**
\`
{
  event: string,
  data: {
    message: string
  } | number
}
\`

**event list:**
- ip.data_validating

this event indicate the data is validating

- ip.on_chain_updating

this event indicate the ip is updating on chain.

- ip.updated

this event indicate the ip is updated, and the data in \`data\` is the detail of ip

- ip.warning

this event indicate the ip is updated, but some warning occurs, this may ip token is created failed or ip token is registered failed, the data in \`data\` is the warning message

**error event:**

if error occurs, the event will be \`error\` and the data in \`data\` is the error message, subscriber will be completed.
data structure:

\`
event: error
id: 2
data: some error message
\`

`,
    })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @NologInterceptor()
    editIp(@Req() req: Request, @ValidEventBody() body: EditIpDto) {
        return this.ipLibraryService.editIp(req.user as UserJwtExtractDto, body)
    }

    @Post("/share-to-giggle")
    @Sse("/share-to-giggle")
    @ApiBody({ type: ShareToGiggleDto })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiOperation({
        summary: "Share an existing ip to giggle",
        description: `
Returns SSE stream with progress updates and final result, 
sse event:

**data structure:**
\`
{
  event: string,
  data: {
    message: string
  } | number
}
\`

**event list:**
- ip.data_validating

this event indicate the data is validating

- asset.uploading
  
this event indicate the asset of creating meme is uploading, at current step, data in \`data\` is the progress of asset uploading.

- meme.creating

this event indicate the meme is creating.

- meme.created

this event indicate the meme is created.

- ip.update_token_data_on_chain

this event indicate the ip is updating token data which just created to chain.

- ip.payment_processing

this event indicate the ip is processing payment, this event only exists when \`share_to_giggle\` is true in request body

- ip.payment_confirmed

this event indicate the ip is confirmed payment, this event only exists when \`share_to_giggle\` is true in request body

- ip.payment_refunded

this event indicate the ip is refunded payment, this event only exists when \`share_to_giggle\` is true in request body

- ip.shared

this event indicate the ip is shared, and the data in \`data\` is the detail of ip

- ip.warning

this event indicate the ip is created, but some warning occurs, this may ip token is created failed or ip token is registered failed, the data in \`data\` is the warning message

**error event:**

if error occurs, the event will be \`error\` and the data in \`data\` is the error message, subscriber will be completed.
data structure:

\`
event: error
id: 2
data: some error message
\`

`,
    })
    @ApiResponse({ type: SSEMessage, status: 200 })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @NologInterceptor()
    shareToGiggle(@Req() req: Request, @ValidEventBody() body: ShareToGiggleDto) {
        return this.ipLibraryService.shareToGiggle(req.user as UserJwtExtractDto, body)
    }

    @Get("/:id")
    @ApiOperation({ summary: "Get detail of ip library" })
    @ApiResponse({ type: IpLibraryDetailDto, status: 200 })
    @UseGuards(OptionalJwtAuthGuard)
    @ApiParam({ name: "id", type: Number })
    async getDetail(@Param("id") id: string, @Req() req: Request): Promise<IpLibraryDetailDto> {
        if (req?.user) {
            return await this.ipLibraryService.detail(id, null, null, req.user as UserJwtExtractDto)
        } else {
            return await this.ipLibraryService.detail(id, true, null, null)
        }
    }

    @Post("/register-token")
    @ApiOperation({ summary: "Register token for an ip" })
    @ApiBody({ type: RegisterTokenDto })
    @ApiResponse({ status: 200 })
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    //@ApiExcludeEndpoint()
    registerToken(@Req() req: Request, @Body() body: RegisterTokenDto) {
        return this.ipLibraryService.registerToken(req.user as UserJwtExtractDto, body)
    }

    @Get("/signature-clips/:id")
    @ApiExcludeEndpoint()
    @UseGuards(AuthGuard("jwt"))
    async getSignatureClipDetail(@Param("id") id: string) {
        return await this.ipLibraryService.signatureClipDetail(id)
    }
}
